import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsMessage } from '../../sms/entities/sms-message.entity';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { SmsService } from '../../sms/services/sms.service';
import { DeliveryStatusCallback, DeliveryStatusService } from './delivery-status.service';

const EVENT_AT = new Date('2026-09-09T10:15:30.000Z');

type SmsServiceMock = jest.Mocked<
  Pick<SmsService, 'findByProviderMessageId' | 'findById' | 'applyDeliveryStatus'>
>;

function buildLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function buildMessage(overrides: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: 'message-id',
    status: SmsStatus.SENT,
    selectedProvider: SmsProviderName.TWILIO,
    providerMessageId: 'SM123',
    ...overrides,
  } as SmsMessage;
}

function buildCallback(overrides: Partial<DeliveryStatusCallback> = {}): DeliveryStatusCallback {
  return {
    provider: SmsProviderName.TWILIO,
    providerMessageId: 'SM123',
    status: SmsStatus.DELIVERED,
    externalStatus: 'delivered',
    eventAt: EVENT_AT,
    lastError: null,
    ...overrides,
  };
}

describe('DeliveryStatusService', () => {
  let smsService: SmsServiceMock;
  let logger: PinoLogger;
  let service: DeliveryStatusService;

  beforeEach(() => {
    smsService = {
      findByProviderMessageId: jest.fn(),
      findById: jest.fn(),
      applyDeliveryStatus: jest.fn(),
    };
    logger = buildLogger();
    service = new DeliveryStatusService(smsService as unknown as SmsService, logger);
    service.onModuleInit();
  });

  it('looks the message up by provider and external id, never by phone number', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(buildMessage());
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await service.apply(
      buildCallback({ provider: SmsProviderName.BIRD, providerMessageId: 'sms_123' }),
    );

    expect(smsService.findByProviderMessageId).toHaveBeenCalledWith(
      SmsProviderName.BIRD,
      'sms_123',
    );
  });

  it('records deliveredAt from the provider event and clears any earlier failure timestamp', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(buildMessage());
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await expect(service.apply(buildCallback())).resolves.toBe('UPDATED');

    expect(smsService.applyDeliveryStatus).toHaveBeenCalledWith({
      messageId: 'message-id',
      status: SmsStatus.DELIVERED,
      allowedPreviousStatuses: [
        SmsStatus.QUEUED,
        SmsStatus.PROCESSING,
        SmsStatus.SENT,
        SmsStatus.UNDELIVERED,
        SmsStatus.REJECTED,
        SmsStatus.FAILED,
      ],
      lastError: null,
      deliveredAt: EVENT_AT,
      failedAt: null,
    });
  });

  it('falls back to the current time when the provider event carries no usable timestamp', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(buildMessage());
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await service.apply(buildCallback({ eventAt: null }));

    expect(smsService.applyDeliveryStatus.mock.calls[0][0].deliveredAt).toBeInstanceOf(Date);
  });

  it('records failedAt and lastError for a delivery failure without touching sentAt', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(buildMessage());
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await service.apply(
      buildCallback({
        status: SmsStatus.UNDELIVERED,
        externalStatus: 'undelivered',
        lastError: 'TWILIO_ERROR_30003',
      }),
    );

    const params = smsService.applyDeliveryStatus.mock.calls[0][0];
    expect(params).toMatchObject({
      status: SmsStatus.UNDELIVERED,
      failedAt: EVENT_AT,
      lastError: 'TWILIO_ERROR_30003',
      allowedPreviousStatuses: [SmsStatus.QUEUED, SmsStatus.PROCESSING, SmsStatus.SENT],
    });
    expect(params).not.toHaveProperty('deliveredAt');
    expect(params.sentAtWhenMissing).toBeUndefined();
  });

  it('only fills sentAt for a SENT callback when the send flow never set it', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(
      buildMessage({ status: SmsStatus.QUEUED }),
    );
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await service.apply(buildCallback({ status: SmsStatus.SENT, externalStatus: 'sent' }));

    expect(smsService.applyDeliveryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        sentAtWhenMissing: EVENT_AT,
        allowedPreviousStatuses: [SmsStatus.QUEUED, SmsStatus.PROCESSING],
      }),
    );
  });

  it('returns NOT_FOUND and logs a warning for an unknown provider message id', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(null);

    await expect(service.apply(buildCallback())).resolves.toBe('NOT_FOUND');

    expect(smsService.applyDeliveryStatus).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: LogEvent.WEBHOOK_MESSAGE_NOT_FOUND }),
      expect.any(String),
    );
  });

  it('refuses to apply a status that no delivery callback may produce', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(buildMessage());

    await expect(
      service.apply(buildCallback({ status: SmsStatus.FATAL_FAILURE, externalStatus: 'unknown' })),
    ).resolves.toBe('IGNORED');

    expect(smsService.applyDeliveryStatus).not.toHaveBeenCalled();
  });

  it('reports a repeated callback as a duplicate without extra side effects', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(
      buildMessage({ status: SmsStatus.DELIVERED }),
    );
    smsService.applyDeliveryStatus.mockResolvedValue(false);
    smsService.findById.mockResolvedValue(buildMessage({ status: SmsStatus.DELIVERED }));

    await expect(service.apply(buildCallback())).resolves.toBe('DUPLICATE');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: LogEvent.WEBHOOK_DUPLICATE }),
      expect.any(String),
    );
  });

  it('reports a status regression as ignored', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(
      buildMessage({ status: SmsStatus.DELIVERED }),
    );
    smsService.applyDeliveryStatus.mockResolvedValue(false);
    smsService.findById.mockResolvedValue(buildMessage({ status: SmsStatus.DELIVERED }));

    await expect(
      service.apply(buildCallback({ status: SmsStatus.SENT, externalStatus: 'sent' })),
    ).resolves.toBe('IGNORED');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.WEBHOOK_STATUS_IGNORED,
        previousStatus: SmsStatus.DELIVERED,
        newStatus: SmsStatus.SENT,
      }),
      expect.any(String),
    );
  });

  it('logs an anomaly when two terminal outcomes conflict', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(
      buildMessage({ status: SmsStatus.DELIVERED }),
    );
    smsService.applyDeliveryStatus.mockResolvedValue(false);
    smsService.findById.mockResolvedValue(buildMessage({ status: SmsStatus.DELIVERED }));

    await expect(
      service.apply(
        buildCallback({
          status: SmsStatus.FAILED,
          externalStatus: 'failed',
          lastError: 'TWILIO_STATUS_FAILED',
        }),
      ),
    ).resolves.toBe('CONFLICT');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: LogEvent.WEBHOOK_STATUS_CONFLICT }),
      expect.any(String),
    );
  });

  it('never writes the recipient phone or the message body into the logs', async () => {
    smsService.findByProviderMessageId.mockResolvedValue(
      buildMessage({ recipientPhone: '+14155552671', messageBody: 'Your code is 482019' }),
    );
    smsService.applyDeliveryStatus.mockResolvedValue(true);

    await service.apply(buildCallback());

    const loggedPayloads = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(loggedPayloads).not.toContain('14155552671');
    expect(loggedPayloads).not.toContain('482019');
  });
});

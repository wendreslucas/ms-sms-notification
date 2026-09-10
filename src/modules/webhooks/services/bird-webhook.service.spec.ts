import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import {
  BirdSignatureVerifier,
  BirdVerificationResult,
} from '../signature/bird-signature.verifier';
import { BirdWebhookService } from './bird-webhook.service';
import { DeliveryStatusService } from './delivery-status.service';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

const WEBHOOK_ID = 'msg_abc';
const RAW_BODY = Buffer.from('{"type":"sms.delivered"}', 'utf8');

function buildLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function buildEvent(type: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type,
    timestamp: '2026-09-09T10:15:30.000Z',
    data: { sms_id: 'sms_123', workspace_id: 'wrk_1', ...data },
  };
}

describe('BirdWebhookService', () => {
  let signatureVerifier: jest.Mocked<Pick<BirdSignatureVerifier, 'verify'>>;
  let webhookIdempotencyService: jest.Mocked<
    Pick<WebhookIdempotencyService, 'claimBirdWebhook' | 'releaseBirdWebhook'>
  >;
  let deliveryStatusService: jest.Mocked<Pick<DeliveryStatusService, 'apply'>>;
  let logger: PinoLogger;
  let service: BirdWebhookService;

  function verificationSucceedsWith(event: unknown): void {
    signatureVerifier.verify.mockResolvedValue({
      ok: true,
      webhookId: WEBHOOK_ID,
      event,
    } as BirdVerificationResult);
  }

  beforeEach(() => {
    signatureVerifier = { verify: jest.fn() };
    webhookIdempotencyService = {
      claimBirdWebhook: jest.fn().mockResolvedValue(true),
      releaseBirdWebhook: jest.fn().mockResolvedValue(undefined),
    };
    deliveryStatusService = { apply: jest.fn().mockResolvedValue('UPDATED') };
    logger = buildLogger();
    service = new BirdWebhookService(
      signatureVerifier as unknown as BirdSignatureVerifier,
      webhookIdempotencyService as unknown as WebhookIdempotencyService,
      deliveryStatusService as unknown as DeliveryStatusService,
      logger,
    );
    service.onModuleInit();
    verificationSucceedsWith(buildEvent('sms.delivered'));
  });

  describe('signature verification', () => {
    it.each([
      'INVALID_SIGNATURE',
      'MISSING_HEADERS',
      'TIMESTAMP_OUT_OF_TOLERANCE',
      'MISSING_RAW_BODY',
      'SECRET_NOT_CONFIGURED',
    ])('rejects a delivery that failed verification with %s', async (reason) => {
      signatureVerifier.verify.mockResolvedValue({ ok: false, reason } as BirdVerificationResult);

      await expect(service.handle(RAW_BODY, {})).rejects.toBeInstanceOf(ForbiddenException);

      expect(deliveryStatusService.apply).not.toHaveBeenCalled();
      expect(webhookIdempotencyService.claimBirdWebhook).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: LogEvent.WEBHOOK_SIGNATURE_INVALID, reason }),
        expect.any(String),
      );
    });

    it('verifies the raw request bytes, not a re-serialized payload', async () => {
      const headers = { 'webhook-id': WEBHOOK_ID };

      await service.handle(RAW_BODY, headers);

      expect(signatureVerifier.verify).toHaveBeenCalledWith(RAW_BODY, headers);
    });
  });

  describe('deduplication', () => {
    it('processes the first delivery of a webhook-id', async () => {
      await service.handle(RAW_BODY, {});

      expect(webhookIdempotencyService.claimBirdWebhook).toHaveBeenCalledWith(WEBHOOK_ID);
      expect(deliveryStatusService.apply).toHaveBeenCalledTimes(1);
    });

    it('drops a repeated delivery of the same webhook-id', async () => {
      webhookIdempotencyService.claimBirdWebhook.mockResolvedValue(false);

      await expect(service.handle(RAW_BODY, {})).resolves.toBeUndefined();

      expect(deliveryStatusService.apply).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: LogEvent.WEBHOOK_DUPLICATE, webhookId: WEBHOOK_ID }),
        expect.any(String),
      );
    });

    it('releases the claim when processing fails so a Bird retry is not swallowed', async () => {
      deliveryStatusService.apply.mockRejectedValue(new Error('database unavailable'));

      await expect(service.handle(RAW_BODY, {})).rejects.toThrow('database unavailable');

      expect(webhookIdempotencyService.releaseBirdWebhook).toHaveBeenCalledWith(WEBHOOK_ID);
    });
  });

  describe('payload validation', () => {
    it.each([
      ['a missing sms id', buildEvent('sms.delivered', { sms_id: undefined })],
      ['a missing event type', { timestamp: '2026-09-09T10:15:30.000Z', data: { sms_id: 'x' } }],
      ['a non-object event', 'not-an-event'],
    ])('rejects %s with 400', async (_label, event) => {
      verificationSucceedsWith(event);

      await expect(service.handle(RAW_BODY, {})).rejects.toBeInstanceOf(BadRequestException);

      expect(webhookIdempotencyService.claimBirdWebhook).not.toHaveBeenCalled();
    });
  });

  describe('status mapping', () => {
    it.each([
      ['sms.delivered', SmsStatus.DELIVERED],
      ['sms.undelivered', SmsStatus.UNDELIVERED],
      ['sms.failed', SmsStatus.FAILED],
      ['sms.rejected', SmsStatus.REJECTED],
      ['sms.sent', SmsStatus.SENT],
      ['sms.expired', SmsStatus.UNDELIVERED],
    ])('applies %s as %s', async (eventType, expectedStatus) => {
      verificationSucceedsWith(buildEvent(eventType, { error: { code: 'unreachable' } }));

      await service.handle(RAW_BODY, {});

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: SmsProviderName.BIRD,
          providerMessageId: 'sms_123',
          status: expectedStatus,
          externalStatus: eventType,
          eventAt: new Date('2026-09-09T10:15:30.000Z'),
        }),
      );
    });

    it.each(['sms.accepted', 'sms.received', 'sms.some_future_event'])(
      'safely ignores %s',
      async (eventType) => {
        verificationSucceedsWith(buildEvent(eventType));

        await expect(service.handle(RAW_BODY, {})).resolves.toBeUndefined();

        expect(deliveryStatusService.apply).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ event: LogEvent.WEBHOOK_STATUS_IGNORED }),
          expect.any(String),
        );
      },
    );
  });

  describe('lastError', () => {
    it('stores the sanitized Bird error code on failure', async () => {
      verificationSucceedsWith(
        buildEvent('sms.failed', {
          error: {
            code: 'blocked_by_carrier',
            description: 'Carrier blocked the message for +14155552671',
            carrier_error_code: '21',
          },
        }),
      );

      await service.handle(RAW_BODY, {});

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: 'BIRD_BLOCKED_BY_CARRIER' }),
      );
    });

    it('never stores the free-form provider description', async () => {
      verificationSucceedsWith(
        buildEvent('sms.failed', {
          error: { code: 'unreachable', description: 'Handset for +14155552671 is unreachable' },
        }),
      );

      await service.handle(RAW_BODY, {});

      const lastError = deliveryStatusService.apply.mock.calls[0][0].lastError;
      expect(lastError).toBe('BIRD_UNREACHABLE');
      expect(lastError).not.toContain('14155552671');
    });

    it('falls back to the event name when Bird sends no error object', async () => {
      verificationSucceedsWith(buildEvent('sms.rejected'));

      await service.handle(RAW_BODY, {});

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: 'BIRD_REJECTED' }),
      );
    });

    it('clears lastError on a successful delivery', async () => {
      await service.handle(RAW_BODY, {});

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: null }),
      );
    });
  });

  it('never logs the recipient phone number carried by the event', async () => {
    verificationSucceedsWith(buildEvent('sms.delivered', { to: '+14155552671' }));

    await service.handle(RAW_BODY, {});

    const loggedPayloads = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ]);
    expect(loggedPayloads).not.toContain('14155552671');
  });
});

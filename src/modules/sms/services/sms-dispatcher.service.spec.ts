import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import { ISmsProvider } from '../../providers/interfaces/sms-provider.interface';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsMessage } from '../entities/sms-message.entity';
import { SmsStatus } from '../entities/sms-status.enum';
import { SmsDispatcherService } from './sms-dispatcher.service';
import { SmsService } from './sms.service';

type SmsServiceMock = {
  findById: jest.Mock<Promise<SmsMessage | null>, [string]>;
  markProcessing: jest.Mock<Promise<boolean>, [string]>;
  markSent: jest.Mock<Promise<void>, [string, string, string | null]>;
  markFailed: jest.Mock<Promise<void>, [string, string, string]>;
};

function buildMessage(overrides: Partial<SmsMessage> = {}): SmsMessage {
  const now = new Date('2026-08-05T21:30:00.000Z');

  return {
    id: 'c8d488e9-f308-43e8-8df0cb5134ef',
    idempotencyKey: 'idem-key',
    recipientPhone: '+14155552671',
    messageBody: 'Your verification code is 482019',
    metadata: null,
    status: SmsStatus.QUEUED,
    attempts: 0,
    selectedProvider: null,
    providerMessageId: null,
    lastError: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SmsDispatcherService', () => {
  let dispatcher: SmsDispatcherService;
  let smsService: SmsServiceMock;
  let provider: ISmsProvider;

  beforeEach(async () => {
    smsService = {
      findById: jest.fn(async (_messageId: string) => buildMessage()),
      markProcessing: jest.fn(async (_messageId: string) => true),
      markSent: jest.fn(
        async (_messageId: string, _provider: string, _providerMessageId: string | null) =>
          undefined,
      ),
      markFailed: jest.fn(
        async (_messageId: string, _provider: string, _lastError: string) => undefined,
      ),
    };
    provider = {
      providerName: SmsProviderName.TWILIO,
      sendSms: jest.fn(async () => ({
        success: true,
        providerMessageId: 'SM123',
        isRetryable: false,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsDispatcherService,
        {
          provide: SmsService,
          useValue: smsService,
        },
        {
          provide: ProviderRegistryService,
          useValue: {
            getPrimaryProvider: () => provider,
          },
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    dispatcher = moduleRef.get(SmsDispatcherService);
  });

  it('processes a queued message successfully', async () => {
    await dispatcher.dispatch('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(smsService.markProcessing).toHaveBeenCalledWith('c8d488e9-f308-43e8-8df0cb5134ef');
    expect(provider.sendSms).toHaveBeenCalledWith({
      to: '+14155552671',
      body: 'Your verification code is 482019',
      referenceId: 'c8d488e9-f308-43e8-8df0cb5134ef',
    });
    expect(smsService.markSent).toHaveBeenCalledWith(
      'c8d488e9-f308-43e8-8df0cb5134ef',
      SmsProviderName.TWILIO,
      'SM123',
    );
  });

  it('throws and does not call provider when the message does not exist', async () => {
    smsService.findById.mockResolvedValue(null);

    await expect(dispatcher.dispatch('missing-id')).rejects.toThrow(
      'SMS message "missing-id" was not found.',
    );

    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it('skips messages already sent', async () => {
    smsService.findById.mockResolvedValue(buildMessage({ status: SmsStatus.SENT }));

    await dispatcher.dispatch('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(provider.sendSms).not.toHaveBeenCalled();
    expect(smsService.markProcessing).not.toHaveBeenCalled();
  });

  it('marks retryable provider failure as failed without failover', async () => {
    provider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'rate limited',
      isRetryable: true,
    }));

    await dispatcher.dispatch('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(smsService.markFailed).toHaveBeenCalledWith(
      'c8d488e9-f308-43e8-8df0cb5134ef',
      SmsProviderName.TWILIO,
      'rate limited',
    );
  });

  it('marks non-retryable provider failure as failed without failover', async () => {
    provider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'invalid phone',
      isRetryable: false,
    }));

    await dispatcher.dispatch('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(smsService.markFailed).toHaveBeenCalledWith(
      'c8d488e9-f308-43e8-8df0cb5134ef',
      SmsProviderName.TWILIO,
      'invalid phone',
    );
  });
});

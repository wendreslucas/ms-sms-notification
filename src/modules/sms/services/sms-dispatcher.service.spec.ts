import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsMessageNotFoundError } from '../../../common/errors/sms-message-not-found-error';
import { ISmsProvider } from '../../providers/interfaces/sms-provider.interface';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ProviderRateLimiterService } from '../../providers/rate-limiting/provider-rate-limiter.service';
import { SmsProviderException } from '../../providers/sms-provider.exception';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { QueueService } from '../../queue/queue.service';
import { SmsMessage } from '../entities/sms-message.entity';
import { SmsStatus } from '../entities/sms-status.enum';
import { SmsDispatcherService } from './sms-dispatcher.service';
import { SmsService } from './sms.service';

type SmsServiceMock = {
  findById: jest.Mock<Promise<SmsMessage | null>, [string]>;
  markProcessing: jest.Mock<Promise<boolean>, [string]>;
  incrementAttempts: jest.Mock<Promise<void>, [string]>;
  markSent: jest.Mock<Promise<void>, [string, string, string | null]>;
  markFatalFailure: jest.Mock<Promise<void>, [string, string, string]>;
};

type RateLimiterMock = {
  throttle: jest.Mock<Promise<void>, [string]>;
};

type QueueServiceMock = {
  enqueueDeadLetter: jest.Mock<Promise<void>, [string]>;
};

type LoggerMock = {
  setContext: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const MESSAGE_ID = 'c8d488e9-f308-43e8-8df0cb5134ef';

function buildMessage(overrides: Partial<SmsMessage> = {}): SmsMessage {
  const now = new Date('2026-08-05T21:30:00.000Z');

  return {
    id: MESSAGE_ID,
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
  let rateLimiter: RateLimiterMock;
  let queueService: QueueServiceMock;
  let providers: ISmsProvider[];
  let twilioProvider: ISmsProvider;
  let birdProvider: ISmsProvider;
  let logger: LoggerMock;

  beforeEach(async () => {
    smsService = {
      findById: jest.fn(async (_messageId: string) => buildMessage()),
      markProcessing: jest.fn(async (_messageId: string) => true),
      incrementAttempts: jest.fn(async (_messageId: string) => undefined),
      markSent: jest.fn(
        async (_messageId: string, _provider: string, _providerMessageId: string | null) =>
          undefined,
      ),
      markFatalFailure: jest.fn(
        async (_messageId: string, _provider: string, _lastError: string) => undefined,
      ),
    };
    rateLimiter = {
      throttle: jest.fn(async (_providerName: string) => undefined),
    };
    queueService = {
      enqueueDeadLetter: jest.fn(async (_messageId: string) => undefined),
    };
    twilioProvider = buildProvider(SmsProviderName.TWILIO, 'SM_TWILIO');
    birdProvider = buildProvider(SmsProviderName.BIRD, 'BIRD_SMS');
    providers = [twilioProvider, birdProvider];
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsDispatcherService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const values = new Map<string, number>([
                ['sms.maxRetries', 3],
                ['sms.retryBaseDelayMs', 1],
              ]);

              const value = values.get(key);

              if (value === undefined) {
                throw new Error(`Missing config ${key}`);
              }

              return value;
            },
          },
        },
        {
          provide: SmsService,
          useValue: smsService,
        },
        {
          provide: ProviderRegistryService,
          useValue: {
            getProviders: () => providers,
            getPrimaryProvider: () => providers[0],
          },
        },
        {
          provide: ProviderRateLimiterService,
          useValue: rateLimiter,
        },
        {
          provide: QueueService,
          useValue: queueService,
        },
        {
          provide: PinoLogger,
          useValue: logger,
        },
      ],
    }).compile();

    dispatcher = moduleRef.get(SmsDispatcherService);
  });

  it('processes a queued message successfully', async () => {
    providers = [twilioProvider];

    await dispatcher.dispatch(MESSAGE_ID);

    expect(smsService.markProcessing).toHaveBeenCalledWith(MESSAGE_ID);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(1);
    expect(rateLimiter.throttle).toHaveBeenCalledWith(SmsProviderName.TWILIO);
    expect(twilioProvider.sendSms).toHaveBeenCalledWith({
      to: '+14155552671',
      body: 'Your verification code is 482019',
      referenceId: MESSAGE_ID,
    });
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.TWILIO,
      'SM_TWILIO',
    );
    expect(findWarnEvent(LogEvent.PROVIDER_FAILED)).toBeUndefined();
  });

  it('throws and does not call provider when the message does not exist', async () => {
    smsService.findById.mockResolvedValue(null);

    await expect(dispatcher.dispatch('missing-id')).rejects.toBeInstanceOf(SmsMessageNotFoundError);

    expect(twilioProvider.sendSms).not.toHaveBeenCalled();
  });

  it.each([
    SmsStatus.SENT,
    SmsStatus.DELIVERED,
    SmsStatus.UNDELIVERED,
    SmsStatus.REJECTED,
    SmsStatus.FAILED,
    SmsStatus.FATAL_FAILURE,
  ])('skips messages already in %s', async (status) => {
    smsService.findById.mockResolvedValue(buildMessage({ status }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).not.toHaveBeenCalled();
    expect(smsService.markProcessing).not.toHaveBeenCalled();
  });

  it('reclaims a message stranded in PROCESSING by an interrupted dispatch', async () => {
    providers = [twilioProvider];
    smsService.findById.mockResolvedValue(
      buildMessage({ status: SmsStatus.PROCESSING, attempts: 2 }),
    );

    await dispatcher.dispatch(MESSAGE_ID);

    expect(smsService.markProcessing).toHaveBeenCalledWith(MESSAGE_ID);
    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.TWILIO,
      'SM_TWILIO',
    );
  });

  it('does not dispatch when another worker holds the claim', async () => {
    smsService.findById.mockResolvedValue(buildMessage({ status: SmsStatus.PROCESSING }));
    smsService.markProcessing.mockResolvedValue(false);

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).not.toHaveBeenCalled();
    expect(smsService.markSent).not.toHaveBeenCalled();
  });

  it('treats a provider that throws as a retryable failure and fails over', async () => {
    twilioProvider.sendSms = jest.fn(async () => {
      throw new Error('socket hang up');
    });

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.markSent).toHaveBeenCalledWith(MESSAGE_ID, SmsProviderName.BIRD, 'BIRD_SMS');
  });

  it('preserves domain provider exceptions thrown by a strategy', async () => {
    twilioProvider.sendSms = jest.fn(async () => {
      throw new SmsProviderException({
        provider: SmsProviderName.TWILIO,
        providerCode: 21608,
        message: 'The number is unverified',
        httpStatus: 400,
        retryable: false,
        providerMetadata: {
          moreInfo: 'https://www.twilio.com/docs/errors/21608',
        },
      });
    });

    await dispatcher.dispatch(MESSAGE_ID);

    expect(findWarnEvent(LogEvent.PROVIDER_FAILED)).toMatchObject({
      event: LogEvent.PROVIDER_FAILED,
      messageId: MESSAGE_ID,
      provider: SmsProviderName.TWILIO,
      providerCode: 21608,
      httpStatus: 400,
      retryable: false,
      error: 'The number is unverified',
      providerMetadata: {
        moreInfo: 'https://www.twilio.com/docs/errors/21608',
      },
    });
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds with the same provider', async () => {
    providers = [twilioProvider];
    twilioProvider.sendSms = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'rate limited',
        isRetryable: true,
        retryAfterMs: 1,
      })
      .mockResolvedValueOnce({
        success: true,
        providerMessageId: 'SM_AFTER_RETRY',
        isRetryable: false,
      });

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(2);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(2);
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.TWILIO,
      'SM_AFTER_RETRY',
    );
    expect(findWarnEvent(LogEvent.PROVIDER_FAILED)).toMatchObject({
      event: LogEvent.PROVIDER_FAILED,
      messageId: MESSAGE_ID,
      provider: SmsProviderName.TWILIO,
      providerAttempt: 1,
      totalAttempts: 1,
      retryable: true,
      error: 'rate limited',
    });
  });

  it('fails over after retryable failures are exhausted', async () => {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'BIRD_AFTER_FAILOVER',
      isRetryable: false,
    }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(4);
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.BIRD,
      'BIRD_AFTER_FAILOVER',
    );
  });

  it('fails over immediately after a non-retryable provider failure', async () => {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'invalid phone',
      isRetryable: false,
      providerCode: 21608,
      httpStatus: 400,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'BIRD_PERMANENT_FAILOVER',
      isRetryable: false,
    }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(2);
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.BIRD,
      'BIRD_PERMANENT_FAILOVER',
    );

    expect(findWarnEvent(LogEvent.PROVIDER_FAILED)).toMatchObject({
      event: LogEvent.PROVIDER_FAILED,
      messageId: MESSAGE_ID,
      provider: SmsProviderName.TWILIO,
      providerAttempt: 1,
      totalAttempts: 1,
      providerCode: 21608,
      httpStatus: 400,
      retryable: false,
      error: 'invalid phone',
    });
    expect(warnEventIndex(LogEvent.PROVIDER_FAILED)).toBeLessThan(
      warnEventIndex(LogEvent.PROVIDER_FAILOVER),
    );
  });

  it('respects provider priority inversion', async () => {
    providers = [birdProvider, twilioProvider];
    birdProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'bird unavailable',
      isRetryable: false,
    }));
    twilioProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'SM_PRIORITY_INVERSION',
      isRetryable: false,
    }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(getFirstCallOrder(birdProvider)).toBeLessThan(getFirstCallOrder(twilioProvider));
    expect(smsService.markSent).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.TWILIO,
      'SM_PRIORITY_INVERSION',
    );
  });

  it('marks fatal failure and publishes DLQ after all retryable attempts are exhausted', async () => {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'bird unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(6);
    expect(smsService.markFatalFailure).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.BIRD,
      'bird unavailable',
    );
    expect(queueService.enqueueDeadLetter).toHaveBeenCalledWith(MESSAGE_ID);
    expect(smsService.markSent).not.toHaveBeenCalled();
  });

  it('marks fatal failure and publishes DLQ after all providers fail with non-retryable errors', async () => {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio invalid payload',
      isRetryable: false,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'bird invalid payload',
      isRetryable: false,
    }));

    await dispatcher.dispatch(MESSAGE_ID);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
    expect(smsService.incrementAttempts).toHaveBeenCalledTimes(2);
    expect(smsService.markFatalFailure).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.BIRD,
      'bird invalid payload',
    );
    expect(queueService.enqueueDeadLetter).toHaveBeenCalledWith(MESSAGE_ID);
  });

  it('keeps fatal failure observable when DLQ publication fails', async () => {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio unavailable',
      isRetryable: false,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'bird unavailable',
      isRetryable: false,
    }));
    queueService.enqueueDeadLetter.mockRejectedValue(new Error('redis unavailable'));

    await expect(dispatcher.dispatch(MESSAGE_ID)).rejects.toThrow('redis unavailable');

    expect(smsService.markFatalFailure).toHaveBeenCalledWith(
      MESSAGE_ID,
      SmsProviderName.BIRD,
      'bird unavailable',
    );
    expect(queueService.enqueueDeadLetter).toHaveBeenCalledWith(MESSAGE_ID);
  });

  function buildProvider(providerName: SmsProviderName, providerMessageId: string): ISmsProvider {
    return {
      providerName,
      sendSms: jest.fn(async () => ({
        success: true,
        providerMessageId,
        isRetryable: false,
      })),
    };
  }

  function getFirstCallOrder(provider: ISmsProvider): number {
    const sendSms = provider.sendSms as jest.Mock;
    const callOrder = sendSms.mock.invocationCallOrder[0];

    if (callOrder === undefined) {
      throw new Error(`Provider ${provider.providerName} was not called.`);
    }

    return callOrder;
  }

  function findWarnEvent(event: LogEvent): Record<string, unknown> | undefined {
    return logger.warn.mock.calls
      .map(([record]) => record as Record<string, unknown>)
      .find((record) => record.event === event);
  }

  function warnEventIndex(event: LogEvent): number {
    return logger.warn.mock.calls.findIndex(
      ([record]) => (record as Record<string, unknown>).event === event,
    );
  }
});

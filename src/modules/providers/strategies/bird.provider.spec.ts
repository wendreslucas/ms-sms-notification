import { ConfigService } from '@nestjs/config';
import type { SmsMessage } from '@messagebird/sdk';

import { SmsProviderName } from '../sms-provider-name.enum';
import { BirdClientFactory, BirdSmsClient } from './bird-provider.tokens';
import { BirdProvider } from './bird.provider';

function buildConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('BirdProvider', () => {
  it('normalizes a successful send', async () => {
    const send = jest.fn(async () => ({ id: 'sms_123' }) as SmsMessage);
    const factory: BirdClientFactory = jest.fn(async (_apiKey: string): Promise<BirdSmsClient> => ({
      sms: { send },
    }));
    const provider = new BirdProvider(
      buildConfig({
        BIRD_API_KEY: 'bk_test',
        BIRD_ORIGINATOR: 'MyBrand',
      }),
      factory,
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(provider.providerName).toBe(SmsProviderName.BIRD);
    expect(send).toHaveBeenCalledWith(
      {
        to: '+14155552671',
        from: 'MyBrand',
        text: 'hello',
        category: 'transactional',
      },
      {
        idempotencyKey: 'sms:message-id:bird',
      },
    );
    expect(result).toEqual({
      success: true,
      providerMessageId: 'sms_123',
      isRetryable: false,
    });
  });

  it.each([
    ['timeout', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
    ['429', Object.assign(new Error('rate limited'), { statusCode: 429 })],
    ['500', Object.assign(new Error('server error'), { statusCode: 500 })],
    ['503', Object.assign(new Error('unavailable'), { statusCode: 503 })],
  ])('classifies %s as retryable', async (_label, error) => {
    const provider = buildProviderWithError(error);

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result.success).toBe(false);
    expect(result.isRetryable).toBe(true);
  });

  it('returns retryAfterMs when the provider exposes retry-after metadata', async () => {
    const provider = buildProviderWithError(
      Object.assign(new Error('rate limited'), {
        statusCode: 429,
        headers: {
          'retry-after': '10',
        },
      }),
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result.retryAfterMs).toBe(10_000);
  });

  it('preserves Bird diagnostic fields when available', async () => {
    const provider = buildProviderWithError(
      Object.assign(new Error('invalid recipient'), {
        code: 'destination_not_allowed',
        statusCode: 403,
      }),
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result).toMatchObject({
      success: false,
      provider: SmsProviderName.BIRD,
      providerCode: 'destination_not_allowed',
      httpStatus: 403,
      error: 'invalid recipient',
      isRetryable: false,
    });
  });

  it('classifies permanent provider errors as non-retryable', async () => {
    const provider = buildProviderWithError(
      Object.assign(new Error('bad request'), { statusCode: 400 }),
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result.success).toBe(false);
    expect(result.isRetryable).toBe(false);
  });

  it('returns a clear non-retryable result when configuration is incomplete', async () => {
    const factory: BirdClientFactory = jest.fn();
    const provider = new BirdProvider(buildConfig({}), factory);

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(factory).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      provider: SmsProviderName.BIRD,
      error: 'Bird configuration is incomplete.',
      isRetryable: false,
    });
  });
});

function buildProviderWithError(error: Error): BirdProvider {
  const factory: BirdClientFactory = jest.fn(async (_apiKey: string): Promise<BirdSmsClient> => ({
    sms: {
      send: jest.fn(async () => {
        throw error;
      }),
    },
  }));

  return new BirdProvider(
    buildConfig({
      BIRD_API_KEY: 'bk_test',
      BIRD_ORIGINATOR: 'MyBrand',
    }),
    factory,
  );
}

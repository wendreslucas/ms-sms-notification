import { ConfigService } from '@nestjs/config';

import { SmsProviderName } from '../sms-provider-name.enum';
import { TwilioClientFactory, TwilioMessageClient } from './twilio-provider.tokens';
import { TwilioProvider } from './twilio.provider';

function buildConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('TwilioProvider', () => {
  it('normalizes a successful send', async () => {
    const create = jest.fn(async () => ({ sid: 'SM123' }));
    const factory: TwilioClientFactory = jest.fn(
      (_accountSid: string, _authToken: string): TwilioMessageClient => ({
        messages: { create },
      }),
    );
    const provider = new TwilioProvider(
      buildConfig({
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_PHONE_NUMBER: '+14155550100',
      }),
      factory,
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(provider.providerName).toBe(SmsProviderName.TWILIO);
    expect(create).toHaveBeenCalledWith({
      to: '+14155552671',
      from: '+14155550100',
      body: 'hello',
    });
    expect(result).toEqual({
      success: true,
      providerMessageId: 'SM123',
      isRetryable: false,
    });
  });

  it.each([
    ['timeout', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
    ['429', Object.assign(new Error('rate limited'), { status: 429 })],
    ['500', Object.assign(new Error('server error'), { status: 500 })],
    ['503', Object.assign(new Error('unavailable'), { status: 503 })],
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
        status: 429,
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

  it('classifies permanent provider errors as non-retryable', async () => {
    const provider = buildProviderWithError(
      Object.assign(new Error('bad request'), { status: 400 }),
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
    const factory: TwilioClientFactory = jest.fn();
    const provider = new TwilioProvider(buildConfig({}), factory);

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(factory).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'Twilio configuration is incomplete.',
      isRetryable: false,
    });
  });
});

function buildProviderWithError(error: Error): TwilioProvider {
  const factory: TwilioClientFactory = jest.fn(
    (_accountSid: string, _authToken: string): TwilioMessageClient => ({
      messages: {
        create: jest.fn(async () => {
          throw error;
        }),
      },
    }),
  );

  return new TwilioProvider(
    buildConfig({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_PHONE_NUMBER: '+14155550100',
    }),
    factory,
  );
}

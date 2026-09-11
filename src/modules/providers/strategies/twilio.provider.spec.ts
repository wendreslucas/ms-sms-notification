import { ConfigService } from '@nestjs/config';

import { SmsProviderName } from '../sms-provider-name.enum';
import { TwilioClientFactory, TwilioMessageClient } from './twilio-provider.tokens';
import { TwilioProvider } from './twilio.provider';

function buildConfig(values: Record<string, unknown>): ConfigService {
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
        'webhooks.publicBaseUrl': 'https://sms.example.com',
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
      statusCallback: 'https://sms.example.com/api/v1/webhooks/twilio',
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

  it('preserves Twilio diagnostic fields without exposing sensitive values from the message', async () => {
    const accountSid = ['AC', '1234567890abcdef1234567890abcdef'].join('');
    const provider = buildProviderWithError(
      Object.assign(
        new Error(`The number +14155552671 is unverified for account ${accountSid}`),
        {
          code: 21608,
          status: 400,
          moreInfo: 'https://www.twilio.com/docs/errors/21608',
        },
      ),
    );

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result).toMatchObject({
      success: false,
      provider: SmsProviderName.TWILIO,
      providerCode: 21608,
      httpStatus: 400,
      isRetryable: false,
      providerMetadata: {
        moreInfo: 'https://www.twilio.com/docs/errors/21608',
      },
    });
    expect(result.error).toContain('+1415***2671');
    expect(result.error).toContain('AC12***cdef');
    expect(result.error).not.toContain('+14155552671');
    expect(result.error).not.toContain(accountSid);
  });

  it('handles Twilio errors that have no code or status', async () => {
    const provider = buildProviderWithError(new Error('Provider request failed upstream'));

    const result = await provider.sendSms({
      to: '+14155552671',
      body: 'hello',
      referenceId: 'message-id',
    });

    expect(result).toEqual({
      success: false,
      provider: SmsProviderName.TWILIO,
      error: 'Provider request failed upstream',
      isRetryable: false,
    });
  });

  it('omits statusCallback when no public base URL is configured', async () => {
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

    await provider.sendSms({ to: '+14155552671', body: 'hello', referenceId: 'message-id' });

    expect(create).toHaveBeenCalledWith({
      to: '+14155552671',
      from: '+14155550100',
      body: 'hello',
    });
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
      provider: SmsProviderName.TWILIO,
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

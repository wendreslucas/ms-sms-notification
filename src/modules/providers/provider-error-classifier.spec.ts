import { SmsProviderException } from './sms-provider.exception';
import { normalizeBirdError, normalizeTwilioError } from './provider-error-classifier';
import { SmsProviderName } from './sms-provider-name.enum';

describe('provider-error-classifier', () => {
  it('converts Twilio errors into a provider domain exception', () => {
    const error = Object.assign(new Error('The number is unverified'), {
      code: 21608,
      status: 400,
      moreInfo: 'https://www.twilio.com/docs/errors/21608',
    });

    const normalized = normalizeTwilioError(error);

    expect(normalized).toBeInstanceOf(SmsProviderException);
    expect(normalized).toMatchObject({
      provider: SmsProviderName.TWILIO,
      providerCode: 21608,
      httpStatus: 400,
      retryable: false,
      message: 'The number is unverified',
      providerMetadata: {
        moreInfo: 'https://www.twilio.com/docs/errors/21608',
      },
    });
  });

  it('keeps retryable classification for provider rate limits and 5xx responses', () => {
    expect(
      normalizeTwilioError(Object.assign(new Error('rate limited'), { status: 429 })),
    ).toMatchObject({
      retryable: true,
      httpStatus: 429,
    });
    expect(
      normalizeBirdError(Object.assign(new Error('unavailable'), { statusCode: 503 })),
    ).toMatchObject({
      retryable: true,
      httpStatus: 503,
    });
  });
});

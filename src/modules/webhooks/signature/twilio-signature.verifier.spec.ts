import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

import { TwilioSignatureVerifier } from './twilio-signature.verifier';

const AUTH_TOKEN = 'twilio-auth-token';
const PUBLIC_BASE_URL = 'https://sms.example.com';
const CALLBACK_URL = 'https://sms.example.com/api/v1/webhooks/twilio';

function buildConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function buildVerifier(overrides: Record<string, unknown> = {}): TwilioSignatureVerifier {
  return new TwilioSignatureVerifier(
    buildConfig({
      'webhooks.twilio.authToken': AUTH_TOKEN,
      'webhooks.publicBaseUrl': PUBLIC_BASE_URL,
      ...overrides,
    }),
  );
}

describe('TwilioSignatureVerifier', () => {
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered' };

  it('accepts a signature produced by the official Twilio helper', () => {
    const signature = Twilio.getExpectedTwilioSignature(AUTH_TOKEN, CALLBACK_URL, params);

    expect(buildVerifier().verify(signature, params)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    expect(buildVerifier().verify('not-a-valid-signature', params)).toBe(false);
  });

  it('rejects a request without a signature header', () => {
    expect(buildVerifier().verify(undefined, params)).toBe(false);
  });

  it('rejects a signature valid for a different set of parameters', () => {
    const signature = Twilio.getExpectedTwilioSignature(AUTH_TOKEN, CALLBACK_URL, params);

    expect(buildVerifier().verify(signature, { ...params, MessageStatus: 'failed' })).toBe(false);
  });

  it('rejects a signature computed for a different public URL', () => {
    const signature = Twilio.getExpectedTwilioSignature(
      AUTH_TOKEN,
      'http://internal-service:3000/api/v1/webhooks/twilio',
      params,
    );

    expect(buildVerifier().verify(signature, params)).toBe(false);
  });

  it('rejects every request while the auth token is not configured', () => {
    const signature = Twilio.getExpectedTwilioSignature(AUTH_TOKEN, CALLBACK_URL, params);

    expect(buildVerifier({ 'webhooks.twilio.authToken': '' }).verify(signature, params)).toBe(
      false,
    );
  });
});

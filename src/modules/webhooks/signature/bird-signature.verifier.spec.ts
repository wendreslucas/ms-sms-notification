import { ConfigService } from '@nestjs/config';

import { testBirdWebhookClientFactory } from '../../../../test/helpers/bird-webhook-unwrapper';
import {
  buildWebhookSecret,
  signStandardWebhook,
} from '../../../../test/helpers/standard-webhooks.signer';
import { BirdSignatureVerifier } from './bird-signature.verifier';

const WEBHOOK_SECRET = buildWebhookSecret();

// Deliberately formatted with the indentation Bird would send, so a verifier that
// re-serialized the parsed JSON would produce different bytes and fail.
const RAW_PAYLOAD = JSON.stringify(
  {
    type: 'sms.delivered',
    timestamp: '2026-09-09T10:15:30.000Z',
    data: { sms_id: 'sms_123', workspace_id: 'wrk_1' },
  },
  null,
  2,
);

function buildVerifier(overrides: Record<string, unknown> = {}): BirdSignatureVerifier {
  const values: Record<string, unknown> = {
    'webhooks.bird.secret': WEBHOOK_SECRET,
    'webhooks.bird.toleranceSeconds': 300,
    ...overrides,
  };

  return new BirdSignatureVerifier(
    { get: (key: string) => values[key] } as ConfigService,
    testBirdWebhookClientFactory,
  );
}

describe('BirdSignatureVerifier', () => {
  it('accepts a correctly signed delivery and returns the verified event', async () => {
    const headers = signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD });

    const result = await buildVerifier().verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({
      ok: true,
      webhookId: headers['webhook-id'],
      event: {
        type: 'sms.delivered',
        timestamp: '2026-09-09T10:15:30.000Z',
        data: { sms_id: 'sms_123', workspace_id: 'wrk_1' },
      },
    });
  });

  it('rejects a body that was altered after signing', async () => {
    const headers = signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD });
    const tamperedBody = RAW_PAYLOAD.replace('sms.delivered', 'sms.failed');

    const result = await buildVerifier().verify(Buffer.from(tamperedBody, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a body re-serialized from the parsed JSON', async () => {
    const headers = signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD });
    const reserializedBody = JSON.stringify(JSON.parse(RAW_PAYLOAD));

    const result = await buildVerifier().verify(Buffer.from(reserializedBody, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a signature produced with a different secret', async () => {
    const headers = signStandardWebhook({
      secret: buildWebhookSecret('a-completely-different-secret-32b'),
      payload: RAW_PAYLOAD,
    });

    const result = await buildVerifier().verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it.each([
    ['webhook-id', 'MISSING_HEADERS'],
    ['webhook-timestamp', 'MISSING_HEADERS'],
    ['webhook-signature', 'MISSING_HEADERS'],
  ])('rejects a delivery without the %s header', async (headerName, reason) => {
    const headers: Record<string, string> = signStandardWebhook({
      secret: WEBHOOK_SECRET,
      payload: RAW_PAYLOAD,
    });
    delete headers[headerName];

    const result = await buildVerifier().verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason });
  });

  it('rejects a replayed delivery whose timestamp is outside the tolerance', async () => {
    const headers = signStandardWebhook({
      secret: WEBHOOK_SECRET,
      payload: RAW_PAYLOAD,
      timestampSeconds: Math.floor(Date.now() / 1000) - 3600,
    });

    const result = await buildVerifier().verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
  });

  it('honours a tolerance narrower than the Standard Webhooks default', async () => {
    const headers = signStandardWebhook({
      secret: WEBHOOK_SECRET,
      payload: RAW_PAYLOAD,
      timestampSeconds: Math.floor(Date.now() / 1000) - 120,
    });

    const verifier = buildVerifier({ 'webhooks.bird.toleranceSeconds': 60 });
    const result = await verifier.verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' });
  });

  it('rejects a timestamp that is not a number', async () => {
    const headers = {
      ...signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD }),
      'webhook-timestamp': 'not-a-timestamp',
    };

    const result = await buildVerifier().verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'INVALID_TIMESTAMP' });
  });

  it('rejects a delivery without a raw body', async () => {
    const headers = signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD });

    await expect(buildVerifier().verify(undefined, headers)).resolves.toEqual({
      ok: false,
      reason: 'MISSING_RAW_BODY',
    });
  });

  it('rejects every delivery while the webhook secret is not configured', async () => {
    const headers = signStandardWebhook({ secret: WEBHOOK_SECRET, payload: RAW_PAYLOAD });

    const verifier = buildVerifier({ 'webhooks.bird.secret': '' });
    const result = await verifier.verify(Buffer.from(RAW_PAYLOAD, 'utf8'), headers);

    expect(result).toEqual({ ok: false, reason: 'SECRET_NOT_CONFIGURED' });
  });
});

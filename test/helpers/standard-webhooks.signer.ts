import { createHmac, randomUUID } from 'node:crypto';

export type StandardWebhookHeaders = Record<string, string> & {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
};

/**
 * Independent implementation of the Standard Webhooks signing scheme used by
 * Bird, so tests exercise the real verification path instead of a stub:
 *
 *   base64(HMAC-SHA256(base64decode(secret), "{id}.{timestamp}.{raw body}"))
 */
export function signStandardWebhook(options: {
  secret: string;
  payload: string;
  webhookId?: string;
  timestampSeconds?: number;
}): StandardWebhookHeaders {
  const webhookId = options.webhookId ?? `msg_${randomUUID()}`;
  const timestampSeconds = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const key = Buffer.from(options.secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${webhookId}.${timestampSeconds}.${options.payload}`)
    .digest('base64');

  return {
    'webhook-id': webhookId,
    'webhook-timestamp': String(timestampSeconds),
    'webhook-signature': `v1,${signature}`,
  };
}

export function buildWebhookSecret(seed = 'bird-webhook-secret-value-32-byte'): string {
  return `whsec_${Buffer.from(seed).toString('base64')}`;
}

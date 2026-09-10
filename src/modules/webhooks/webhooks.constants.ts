import { API_DEFAULT_VERSION, API_GLOBAL_PREFIX } from '../../config/constants';

export const WEBHOOKS_ROUTE_PATH = 'webhooks';
export const TWILIO_WEBHOOK_ROUTE = 'twilio';
export const BIRD_WEBHOOK_ROUTE = 'bird';

export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';
export const BIRD_WEBHOOK_ID_HEADER = 'webhook-id';
export const BIRD_WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
export const BIRD_WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

export const BIRD_WEBHOOK_IDEMPOTENCY_KEY_PREFIX = 'sms:webhook:bird';

/**
 * Builds the absolute, publicly reachable webhook URL for a provider callback.
 *
 * Twilio signs the exact URL it calls, so this must resolve to the same origin
 * the provider was configured with. Behind a proxy or load balancer the
 * internal request may arrive as plain HTTP while Twilio called HTTPS, which is
 * why the origin comes from PUBLIC_BASE_URL instead of request headers.
 */
export function buildPublicWebhookUrl(publicBaseUrl: string, route: string): string {
  const normalizedBaseUrl = publicBaseUrl.replace(/\/+$/, '');

  return `${normalizedBaseUrl}/${API_GLOBAL_PREFIX}/v${API_DEFAULT_VERSION}/${WEBHOOKS_ROUTE_PATH}/${route}`;
}

export function buildTwilioStatusCallbackUrl(publicBaseUrl: string): string {
  return buildPublicWebhookUrl(publicBaseUrl, TWILIO_WEBHOOK_ROUTE);
}

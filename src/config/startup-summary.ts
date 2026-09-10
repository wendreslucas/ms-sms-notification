import {
  BIRD_WEBHOOK_ROUTE,
  buildPublicWebhookUrl,
  TWILIO_WEBHOOK_ROUTE,
} from '../modules/webhooks/webhooks.constants';
import { API_GLOBAL_PREFIX, HEALTH_ROUTE_PATH, SWAGGER_DOCS_PATH } from './constants';

export interface StartupSummaryInput {
  environment: string;
  applicationUrl: string;
  publicBaseUrl?: string;
}

export interface StartupSummary {
  environment: string;
  applicationUrl: string;
  swaggerUrl: string;
  healthUrl: string;
  twilioWebhookUrl: string;
  birdWebhookUrl: string;
  /** Set only when PUBLIC_BASE_URL points somewhere other than this instance. */
  publicBaseUrl: string | null;
  publicTwilioWebhookUrl: string | null;
  publicBirdWebhookUrl: string | null;
}

const SEPARATOR = '-'.repeat(62);
const LABEL_WIDTH = 12;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Rewrites the address Nest reports into something a developer can click.
 *
 * `app.getUrl()` reports the bound socket, which for the default host is the
 * wildcard address (`http://[::1]:3000` or `http://0.0.0.0:3000`).
 */
export function normalizeApplicationUrl(applicationUrl: string): string {
  return stripTrailingSlashes(applicationUrl).replace(
    /:\/\/(\[::1\]|\[::\]|::1|0\.0\.0\.0|127\.0\.0\.1)(?=[:/]|$)/,
    '://localhost',
  );
}

/**
 * Resolves every URL worth showing at startup from the routing constants the
 * application actually registers, so the summary cannot drift from the real
 * routes.
 *
 * `publicBaseUrl` is reported separately only when it differs from the address
 * this instance is listening on. It carries a default of `http://localhost:3000`,
 * so treating it as "configured" whenever it is merely present would claim the
 * providers can reach an instance that is not publicly addressable.
 */
export function buildStartupSummary(input: StartupSummaryInput): StartupSummary {
  const applicationUrl = normalizeApplicationUrl(input.applicationUrl);
  const publicBaseUrl = input.publicBaseUrl ? stripTrailingSlashes(input.publicBaseUrl) : '';
  const hasDistinctPublicUrl =
    publicBaseUrl.length > 0 && normalizeApplicationUrl(publicBaseUrl) !== applicationUrl;

  return {
    environment: input.environment,
    applicationUrl,
    swaggerUrl: `${applicationUrl}/${API_GLOBAL_PREFIX}/${SWAGGER_DOCS_PATH}`,
    healthUrl: `${applicationUrl}/${API_GLOBAL_PREFIX}/${HEALTH_ROUTE_PATH}`,
    twilioWebhookUrl: buildPublicWebhookUrl(applicationUrl, TWILIO_WEBHOOK_ROUTE),
    birdWebhookUrl: buildPublicWebhookUrl(applicationUrl, BIRD_WEBHOOK_ROUTE),
    publicBaseUrl: hasDistinctPublicUrl ? publicBaseUrl : null,
    publicTwilioWebhookUrl: hasDistinctPublicUrl
      ? buildPublicWebhookUrl(publicBaseUrl, TWILIO_WEBHOOK_ROUTE)
      : null,
    publicBirdWebhookUrl: hasDistinctPublicUrl
      ? buildPublicWebhookUrl(publicBaseUrl, BIRD_WEBHOOK_ROUTE)
      : null,
  };
}

function line(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}: ${value}`;
}

/**
 * Renders the summary as a block meant for a developer's terminal.
 *
 * Production keeps the structured single-event log instead; this exists so
 * local development is readable, not to replace observability.
 */
export function formatStartupSummary(summary: StartupSummary): string {
  const lines = [
    SEPARATOR,
    'SMS Notification Microservice started successfully',
    SEPARATOR,
    line('Environment', summary.environment),
    line('Application', summary.applicationUrl),
  ];

  if (summary.publicBaseUrl) {
    lines.push(line('Public URL', summary.publicBaseUrl));
  }

  lines.push(line('Swagger', summary.swaggerUrl), line('Health', summary.healthUrl));

  lines.push(
    '',
    'Webhooks (local)',
    line('Twilio', summary.twilioWebhookUrl),
    line('Bird', summary.birdWebhookUrl),
  );

  if (summary.publicTwilioWebhookUrl && summary.publicBirdWebhookUrl) {
    lines.push(
      '',
      'Webhooks (public, as the providers reach them)',
      line('Twilio', summary.publicTwilioWebhookUrl),
      line('Bird', summary.publicBirdWebhookUrl),
    );
  } else {
    lines.push(
      '',
      'PUBLIC_BASE_URL is not set to a publicly reachable origin, so provider',
      'callbacks cannot arrive from Twilio or Bird on this instance.',
    );
  }

  lines.push(SEPARATOR);

  return lines.join('\n');
}

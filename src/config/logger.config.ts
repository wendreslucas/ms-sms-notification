import type { Params } from 'nestjs-pino';

/**
 * Header values that must never reach the logs.
 *
 * `pino-http` serializes every request header by default, so provider webhook
 * signatures would otherwise be written in full on each callback. A signature
 * authenticates one specific request, which makes it a credential worth keeping
 * out of log storage.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-twilio-signature"]',
  'req.headers["webhook-signature"]',
];

export function buildLoggerParams(nodeEnv: string | undefined): Params {
  return {
    pinoHttp: {
      level: nodeEnv === 'production' ? 'info' : 'debug',
      redact: REDACTED_LOG_PATHS,
    },
  };
}

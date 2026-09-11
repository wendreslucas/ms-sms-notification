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
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["set-cookie"]',
  'req.headers["Set-Cookie"]',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["X-Api-Key"]',
  'req.headers["X-API-Key"]',
  'req.headers["x-twilio-signature"]',
  'req.headers["X-Twilio-Signature"]',
  'req.headers["webhook-signature"]',
  'req.headers["Webhook-Signature"]',
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'headers.Cookie',
  'headers["set-cookie"]',
  'headers["Set-Cookie"]',
  'headers["x-api-key"]',
  'headers["X-Api-Key"]',
  'headers["X-API-Key"]',
  'headers["x-twilio-signature"]',
  'headers["X-Twilio-Signature"]',
  'headers["webhook-signature"]',
  'headers["Webhook-Signature"]',
  'TWILIO_AUTH_TOKEN',
  'BIRD_API_KEY',
  'authToken',
  'apiKey',
  'twilioAuthToken',
  'birdApiKey',
  'config.authToken',
  'config.apiKey',
  'providerMetadata.authToken',
  'providerMetadata.apiKey',
];

export function buildLoggerParams(nodeEnv: string | undefined): Params {
  const isProduction = nodeEnv === 'production';

  return {
    pinoHttp: {
      level: isProduction ? 'info' : 'debug',
      redact: REDACTED_LOG_PATHS,
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
      customSuccessMessage: (req, res, responseTime) =>
        `HTTP ${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res, error) =>
        `HTTP ${req.method} ${req.url} ${res.statusCode} - ${error.message}`,
      ...(isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname,req,res,responseTime',
                messageFormat: '{context} {event} {msg}',
              },
            },
          }),
    },
  };
}

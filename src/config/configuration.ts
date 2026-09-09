export const configuration = () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5433),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    name: process.env.DATABASE_NAME,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6380),
  },
  sms: {
    providerPriority: process.env.SMS_PROVIDER_PRIORITY ?? 'twilio,bird',
    maxRetries: Number(process.env.SMS_MAX_RETRIES ?? 3),
    retryBaseDelayMs: Number(process.env.SMS_RETRY_BASE_DELAY_MS ?? 2000),
    idempotencyTtlSeconds: Number(process.env.SMS_IDEMPOTENCY_TTL_SECONDS ?? 86400),
    maxMessageLength: Number(process.env.SMS_MAX_MESSAGE_LENGTH ?? 1600),
  },
  providers: {
    twilio: {
      rateLimitMax: Number(process.env.TWILIO_RATE_LIMIT_MAX ?? 10),
      rateLimitDurationMs: Number(process.env.TWILIO_RATE_LIMIT_DURATION_MS ?? 1000),
    },
    bird: {
      rateLimitMax: Number(process.env.BIRD_RATE_LIMIT_MAX ?? 10),
      rateLimitDurationMs: Number(process.env.BIRD_RATE_LIMIT_DURATION_MS ?? 1000),
    },
  },
});

import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  PUBLIC_BASE_URL: Joi.string().uri().default('http://localhost:3000'),

  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().required(),
  DATABASE_USER: Joi.string().min(1).required(),
  DATABASE_PASSWORD: Joi.string().allow('').required(),
  DATABASE_NAME: Joi.string().min(1).required(),

  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().required(),

  SMS_PROVIDER_PRIORITY: Joi.string().min(1).required(),
  SMS_MAX_RETRIES: Joi.number().integer().min(1).required(),
  SMS_RETRY_BASE_DELAY_MS: Joi.number().integer().min(1).required(),
  SMS_IDEMPOTENCY_TTL_SECONDS: Joi.number().integer().min(1).required(),
  SMS_MAX_MESSAGE_LENGTH: Joi.number().integer().min(1).required(),
  SMS_JOB_ATTEMPTS: Joi.number().integer().min(1).default(3),
  SMS_JOB_BACKOFF_DELAY_MS: Joi.number().integer().min(1).default(1000),

  TWILIO_RATE_LIMIT_MAX: Joi.number().integer().min(1).required(),
  TWILIO_RATE_LIMIT_DURATION_MS: Joi.number().integer().min(1).required(),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_PHONE_NUMBER: Joi.string().allow('').optional(),
  BIRD_RATE_LIMIT_MAX: Joi.number().integer().min(1).required(),
  BIRD_RATE_LIMIT_DURATION_MS: Joi.number().integer().min(1).required(),
  BIRD_API_KEY: Joi.string().allow('').optional(),
  BIRD_ORIGINATOR: Joi.string().allow('').optional(),
  BIRD_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  WEBHOOK_IDEMPOTENCY_TTL_SECONDS: Joi.number().integer().min(1).default(86400),
  BIRD_WEBHOOK_TOLERANCE_SECONDS: Joi.number().integer().min(1).default(300),
});

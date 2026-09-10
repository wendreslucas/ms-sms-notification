import { AppError, ErrorDetails } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';
import { IdempotencyConflictError } from './idempotency-conflict-error';
import { IdempotencyKeyRequiredError } from './idempotency-key-required-error';
import { IdempotencyKeyTooLongError } from './idempotency-key-too-long-error';
import { InvalidBirdPayloadError } from './invalid-bird-payload-error';
import { InvalidBirdSignatureError } from './invalid-bird-signature-error';
import { InvalidJobPayloadError } from './invalid-job-payload-error';
import { InvalidRetryConfigurationError } from './invalid-retry-configuration-error';
import { InvalidTwilioPayloadError } from './invalid-twilio-payload-error';
import { InvalidTwilioSignatureError } from './invalid-twilio-signature-error';
import { NoProviderConfiguredError } from './no-provider-configured-error';
import { ProviderNotRegisteredError } from './provider-not-registered-error';
import { ProviderPriorityEmptyError } from './provider-priority-empty-error';
import { QueuePublishFailedError } from './queue-publish-failed-error';
import { RateLimitStoreInvalidResponseError } from './rate-limit-store-invalid-response-error';
import { RequeueConflictError } from './requeue-conflict-error';
import { RequeueNotEligibleError } from './requeue-not-eligible-error';
import { SmsMessageNotFoundError } from './sms-message-not-found-error';
import { SmsMessageTooLongError } from './sms-message-too-long-error';
import { UnknownProviderError } from './unknown-provider-error';
import { UnsupportedJobError } from './unsupported-job-error';

interface ErrorCase {
  error: AppError;
  code: ErrorCode;
  details?: ErrorDetails;
}

const CASES: ErrorCase[] = [
  { error: new IdempotencyKeyRequiredError(), code: ErrorCode.SMS_IDEMPOTENCY_KEY_REQUIRED },
  { error: new IdempotencyKeyTooLongError(), code: ErrorCode.SMS_IDEMPOTENCY_KEY_TOO_LONG },
  { error: new IdempotencyConflictError(), code: ErrorCode.SMS_IDEMPOTENCY_CONFLICT },
  {
    error: new SmsMessageTooLongError(1600),
    code: ErrorCode.SMS_MESSAGE_TOO_LONG,
    details: { maxLength: 1600 },
  },
  { error: new SmsMessageNotFoundError(), code: ErrorCode.SMS_MESSAGE_NOT_FOUND },
  { error: new QueuePublishFailedError(), code: ErrorCode.SMS_QUEUE_PUBLISH_FAILED },
  { error: new RequeueNotEligibleError(), code: ErrorCode.SMS_REQUEUE_NOT_ELIGIBLE },
  { error: new RequeueConflictError(), code: ErrorCode.SMS_REQUEUE_CONFLICT },
  {
    error: new UnsupportedJobError('unknown-job'),
    code: ErrorCode.QUEUE_UNSUPPORTED_JOB,
    details: { jobName: 'unknown-job' },
  },
  { error: new InvalidJobPayloadError(), code: ErrorCode.QUEUE_INVALID_JOB_PAYLOAD },
  { error: new ProviderPriorityEmptyError(), code: ErrorCode.PROVIDER_PRIORITY_EMPTY },
  { error: new NoProviderConfiguredError(), code: ErrorCode.PROVIDER_NONE_CONFIGURED },
  {
    error: new UnknownProviderError('vonage'),
    code: ErrorCode.PROVIDER_UNKNOWN,
    details: { provider: 'vonage' },
  },
  {
    error: new ProviderNotRegisteredError('bird'),
    code: ErrorCode.PROVIDER_NOT_REGISTERED,
    details: { provider: 'bird' },
  },
  {
    error: new RateLimitStoreInvalidResponseError(),
    code: ErrorCode.RATE_LIMIT_STORE_INVALID_RESPONSE,
  },
  {
    error: new InvalidRetryConfigurationError('attempt', 0),
    code: ErrorCode.RETRY_INVALID_CONFIGURATION,
    details: { parameter: 'attempt', value: 0 },
  },
  { error: new InvalidTwilioSignatureError(), code: ErrorCode.WEBHOOK_TWILIO_SIGNATURE_INVALID },
  { error: new InvalidTwilioPayloadError(), code: ErrorCode.WEBHOOK_TWILIO_PAYLOAD_INVALID },
  { error: new InvalidBirdSignatureError(), code: ErrorCode.WEBHOOK_BIRD_SIGNATURE_INVALID },
  { error: new InvalidBirdPayloadError(), code: ErrorCode.WEBHOOK_BIRD_PAYLOAD_INVALID },
];

describe('application errors', () => {
  it('has an error class for every error code', () => {
    expect(new Set(CASES.map(({ code }) => code))).toEqual(new Set(Object.values(ErrorCode)));
  });

  it.each(CASES)('$error.name carries $code from the catalog', ({ error, code, details }) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(error.constructor.name);
    expect(error.code).toBe(code);
    expect(error.message).toBe(ERROR_CATALOG[code].message);
    expect(error.httpStatus).toBe(ERROR_CATALOG[code].httpStatus);
    expect(error.details).toEqual(details);
  });
});

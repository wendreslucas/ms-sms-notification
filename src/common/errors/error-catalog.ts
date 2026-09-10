import { HttpStatus } from '@nestjs/common';

import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH } from '../../config/constants';

/**
 * Every error the service raises on purpose, grouped by the area it belongs
 * to. The value is what clients and logs see, so it never changes once
 * published.
 */
export enum ErrorCode {
  SMS_IDEMPOTENCY_KEY_REQUIRED = 'SMS_IDEMPOTENCY_KEY_REQUIRED',
  SMS_IDEMPOTENCY_KEY_TOO_LONG = 'SMS_IDEMPOTENCY_KEY_TOO_LONG',
  SMS_IDEMPOTENCY_CONFLICT = 'SMS_IDEMPOTENCY_CONFLICT',
  SMS_MESSAGE_TOO_LONG = 'SMS_MESSAGE_TOO_LONG',
  SMS_MESSAGE_NOT_FOUND = 'SMS_MESSAGE_NOT_FOUND',
  SMS_QUEUE_PUBLISH_FAILED = 'SMS_QUEUE_PUBLISH_FAILED',
  SMS_REQUEUE_NOT_ELIGIBLE = 'SMS_REQUEUE_NOT_ELIGIBLE',
  SMS_REQUEUE_CONFLICT = 'SMS_REQUEUE_CONFLICT',

  QUEUE_UNSUPPORTED_JOB = 'QUEUE_UNSUPPORTED_JOB',
  QUEUE_INVALID_JOB_PAYLOAD = 'QUEUE_INVALID_JOB_PAYLOAD',

  PROVIDER_PRIORITY_EMPTY = 'PROVIDER_PRIORITY_EMPTY',
  PROVIDER_NONE_CONFIGURED = 'PROVIDER_NONE_CONFIGURED',
  PROVIDER_UNKNOWN = 'PROVIDER_UNKNOWN',
  PROVIDER_NOT_REGISTERED = 'PROVIDER_NOT_REGISTERED',
  PROVIDER_DUPLICATE = 'PROVIDER_DUPLICATE',

  RATE_LIMIT_STORE_INVALID_RESPONSE = 'RATE_LIMIT_STORE_INVALID_RESPONSE',
  RATE_LIMIT_NOT_CONFIGURED = 'RATE_LIMIT_NOT_CONFIGURED',
  RETRY_INVALID_CONFIGURATION = 'RETRY_INVALID_CONFIGURATION',

  WEBHOOK_TWILIO_SIGNATURE_INVALID = 'WEBHOOK_TWILIO_SIGNATURE_INVALID',
  WEBHOOK_TWILIO_PAYLOAD_INVALID = 'WEBHOOK_TWILIO_PAYLOAD_INVALID',
  WEBHOOK_BIRD_SIGNATURE_INVALID = 'WEBHOOK_BIRD_SIGNATURE_INVALID',
  WEBHOOK_BIRD_PAYLOAD_INVALID = 'WEBHOOK_BIRD_PAYLOAD_INVALID',
}

export interface ErrorDefinition {
  /** Fixed, client-safe text. Variable values travel in the error's details. */
  readonly message: string;
  readonly httpStatus: HttpStatus;
}

/**
 * Single source of truth for error messages and HTTP statuses. Errors that
 * only occur inside the worker or at startup use 500: they never reach a
 * client under normal operation, but a status keeps the mapping total.
 */
export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  [ErrorCode.SMS_IDEMPOTENCY_KEY_REQUIRED]: {
    message: `${IDEMPOTENCY_KEY_HEADER} header is required.`,
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  [ErrorCode.SMS_IDEMPOTENCY_KEY_TOO_LONG]: {
    message: `${IDEMPOTENCY_KEY_HEADER} must be shorter than or equal to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  [ErrorCode.SMS_IDEMPOTENCY_CONFLICT]: {
    message: 'A request with this idempotency key is already being processed.',
    httpStatus: HttpStatus.CONFLICT,
  },
  [ErrorCode.SMS_MESSAGE_TOO_LONG]: {
    message: 'message must be shorter than or equal to the configured maximum length.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  [ErrorCode.SMS_MESSAGE_NOT_FOUND]: {
    message: 'SMS message was not found.',
    httpStatus: HttpStatus.NOT_FOUND,
  },
  [ErrorCode.SMS_QUEUE_PUBLISH_FAILED]: {
    message: 'SMS request was persisted, but queue publication failed.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.SMS_REQUEUE_NOT_ELIGIBLE]: {
    message: 'Only messages in FATAL_FAILURE can be requeued.',
    httpStatus: HttpStatus.CONFLICT,
  },
  [ErrorCode.SMS_REQUEUE_CONFLICT]: {
    message: 'SMS message is no longer eligible for requeue.',
    httpStatus: HttpStatus.CONFLICT,
  },

  [ErrorCode.QUEUE_UNSUPPORTED_JOB]: {
    message: 'Unsupported SMS job.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.QUEUE_INVALID_JOB_PAYLOAD]: {
    message: 'SMS job payload must contain a valid messageId UUID.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },

  [ErrorCode.PROVIDER_PRIORITY_EMPTY]: {
    message: 'SMS_PROVIDER_PRIORITY must contain at least one provider.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.PROVIDER_NONE_CONFIGURED]: {
    message: 'No SMS provider is configured.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.PROVIDER_UNKNOWN]: {
    message: 'Unknown SMS provider.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.PROVIDER_NOT_REGISTERED]: {
    message: 'SMS provider is not registered.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.PROVIDER_DUPLICATE]: {
    message: 'More than one SMS provider is registered under the same name.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },

  [ErrorCode.RATE_LIMIT_STORE_INVALID_RESPONSE]: {
    message: 'Rate-limit store returned an unexpected response.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.RATE_LIMIT_NOT_CONFIGURED]: {
    message: 'SMS provider has no valid rate limit configured.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  [ErrorCode.RETRY_INVALID_CONFIGURATION]: {
    message: 'Retry attempt and base delay must be greater than or equal to 1.',
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
  },

  [ErrorCode.WEBHOOK_TWILIO_SIGNATURE_INVALID]: {
    message: 'Invalid Twilio webhook signature.',
    httpStatus: HttpStatus.FORBIDDEN,
  },
  [ErrorCode.WEBHOOK_TWILIO_PAYLOAD_INVALID]: {
    message: 'Twilio callback is missing MessageSid or MessageStatus.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
  [ErrorCode.WEBHOOK_BIRD_SIGNATURE_INVALID]: {
    message: 'Invalid Bird webhook signature.',
    httpStatus: HttpStatus.FORBIDDEN,
  },
  [ErrorCode.WEBHOOK_BIRD_PAYLOAD_INVALID]: {
    message: 'Bird webhook is missing the event type or sms id.',
    httpStatus: HttpStatus.BAD_REQUEST,
  },
};

import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class IdempotencyKeyTooLongError extends AppError {
  constructor() {
    super(
      ErrorCode.SMS_IDEMPOTENCY_KEY_TOO_LONG,
      ERROR_CATALOG[ErrorCode.SMS_IDEMPOTENCY_KEY_TOO_LONG],
    );
  }
}

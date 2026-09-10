import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class IdempotencyKeyRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.SMS_IDEMPOTENCY_KEY_REQUIRED,
      ERROR_CATALOG[ErrorCode.SMS_IDEMPOTENCY_KEY_REQUIRED],
    );
  }
}

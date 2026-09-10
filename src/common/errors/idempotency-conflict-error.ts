import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class IdempotencyConflictError extends AppError {
  constructor() {
    super(ErrorCode.SMS_IDEMPOTENCY_CONFLICT, ERROR_CATALOG[ErrorCode.SMS_IDEMPOTENCY_CONFLICT]);
  }
}

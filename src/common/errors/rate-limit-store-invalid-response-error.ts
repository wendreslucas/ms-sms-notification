import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class RateLimitStoreInvalidResponseError extends AppError {
  constructor() {
    super(
      ErrorCode.RATE_LIMIT_STORE_INVALID_RESPONSE,
      ERROR_CATALOG[ErrorCode.RATE_LIMIT_STORE_INVALID_RESPONSE],
    );
  }
}

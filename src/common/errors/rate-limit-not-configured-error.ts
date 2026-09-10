import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class RateLimitNotConfiguredError extends AppError {
  constructor(provider: string) {
    super(ErrorCode.RATE_LIMIT_NOT_CONFIGURED, ERROR_CATALOG[ErrorCode.RATE_LIMIT_NOT_CONFIGURED], {
      provider,
    });
  }
}

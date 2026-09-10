import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class UnknownProviderError extends AppError {
  constructor(provider: string) {
    super(ErrorCode.PROVIDER_UNKNOWN, ERROR_CATALOG[ErrorCode.PROVIDER_UNKNOWN], { provider });
  }
}

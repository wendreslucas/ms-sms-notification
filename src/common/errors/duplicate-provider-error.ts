import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class DuplicateProviderError extends AppError {
  constructor(provider: string) {
    super(ErrorCode.PROVIDER_DUPLICATE, ERROR_CATALOG[ErrorCode.PROVIDER_DUPLICATE], { provider });
  }
}

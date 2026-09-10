import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class ProviderNotRegisteredError extends AppError {
  constructor(provider: string) {
    super(ErrorCode.PROVIDER_NOT_REGISTERED, ERROR_CATALOG[ErrorCode.PROVIDER_NOT_REGISTERED], {
      provider,
    });
  }
}

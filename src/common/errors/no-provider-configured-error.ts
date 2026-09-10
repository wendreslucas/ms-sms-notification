import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class NoProviderConfiguredError extends AppError {
  constructor() {
    super(ErrorCode.PROVIDER_NONE_CONFIGURED, ERROR_CATALOG[ErrorCode.PROVIDER_NONE_CONFIGURED]);
  }
}

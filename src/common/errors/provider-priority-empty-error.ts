import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class ProviderPriorityEmptyError extends AppError {
  constructor() {
    super(ErrorCode.PROVIDER_PRIORITY_EMPTY, ERROR_CATALOG[ErrorCode.PROVIDER_PRIORITY_EMPTY]);
  }
}

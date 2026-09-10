import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class InvalidRetryConfigurationError extends AppError {
  constructor(parameter: 'attempt' | 'baseDelayMs', value: number) {
    super(
      ErrorCode.RETRY_INVALID_CONFIGURATION,
      ERROR_CATALOG[ErrorCode.RETRY_INVALID_CONFIGURATION],
      { parameter, value },
    );
  }
}

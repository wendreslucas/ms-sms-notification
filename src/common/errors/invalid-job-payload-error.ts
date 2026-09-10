import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class InvalidJobPayloadError extends AppError {
  constructor() {
    super(ErrorCode.QUEUE_INVALID_JOB_PAYLOAD, ERROR_CATALOG[ErrorCode.QUEUE_INVALID_JOB_PAYLOAD]);
  }
}

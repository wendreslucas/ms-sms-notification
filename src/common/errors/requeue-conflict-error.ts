import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class RequeueConflictError extends AppError {
  constructor() {
    super(ErrorCode.SMS_REQUEUE_CONFLICT, ERROR_CATALOG[ErrorCode.SMS_REQUEUE_CONFLICT]);
  }
}

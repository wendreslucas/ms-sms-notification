import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class RequeueNotEligibleError extends AppError {
  constructor() {
    super(ErrorCode.SMS_REQUEUE_NOT_ELIGIBLE, ERROR_CATALOG[ErrorCode.SMS_REQUEUE_NOT_ELIGIBLE]);
  }
}

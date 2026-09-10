import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class QueuePublishFailedError extends AppError {
  constructor() {
    super(ErrorCode.SMS_QUEUE_PUBLISH_FAILED, ERROR_CATALOG[ErrorCode.SMS_QUEUE_PUBLISH_FAILED]);
  }
}

import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class SmsMessageNotFoundError extends AppError {
  constructor() {
    super(ErrorCode.SMS_MESSAGE_NOT_FOUND, ERROR_CATALOG[ErrorCode.SMS_MESSAGE_NOT_FOUND]);
  }
}

import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class SmsMessageTooLongError extends AppError {
  constructor(maxLength: number) {
    super(ErrorCode.SMS_MESSAGE_TOO_LONG, ERROR_CATALOG[ErrorCode.SMS_MESSAGE_TOO_LONG], {
      maxLength,
    });
  }
}

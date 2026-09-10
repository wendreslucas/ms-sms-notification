import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class InvalidTwilioSignatureError extends AppError {
  constructor() {
    super(
      ErrorCode.WEBHOOK_TWILIO_SIGNATURE_INVALID,
      ERROR_CATALOG[ErrorCode.WEBHOOK_TWILIO_SIGNATURE_INVALID],
    );
  }
}

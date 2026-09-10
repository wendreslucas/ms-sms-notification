import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class InvalidTwilioPayloadError extends AppError {
  constructor() {
    super(
      ErrorCode.WEBHOOK_TWILIO_PAYLOAD_INVALID,
      ERROR_CATALOG[ErrorCode.WEBHOOK_TWILIO_PAYLOAD_INVALID],
    );
  }
}

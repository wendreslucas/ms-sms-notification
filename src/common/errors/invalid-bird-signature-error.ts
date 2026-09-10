import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class InvalidBirdSignatureError extends AppError {
  constructor() {
    super(
      ErrorCode.WEBHOOK_BIRD_SIGNATURE_INVALID,
      ERROR_CATALOG[ErrorCode.WEBHOOK_BIRD_SIGNATURE_INVALID],
    );
  }
}

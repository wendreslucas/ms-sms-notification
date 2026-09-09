import { BadRequestException } from '@nestjs/common';

export class IdempotencyKeyRequiredException extends BadRequestException {
  constructor(message = 'X-Idempotency-Key header is required.') {
    super(message);
  }
}

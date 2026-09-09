import { InternalServerErrorException } from '@nestjs/common';

export class QueuePublishException extends InternalServerErrorException {
  constructor() {
    super('SMS request was persisted, but queue publication failed.');
  }
}

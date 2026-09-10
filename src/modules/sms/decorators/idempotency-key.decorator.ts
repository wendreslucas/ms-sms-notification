import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { IdempotencyKeyRequiredError } from '../../../common/errors/idempotency-key-required-error';
import { IdempotencyKeyTooLongError } from '../../../common/errors/idempotency-key-too-long-error';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH } from '../../../config/constants';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.header(IDEMPOTENCY_KEY_HEADER);

    if (!value || value.trim().length === 0) {
      throw new IdempotencyKeyRequiredError();
    }

    const trimmedValue = value.trim();

    if (trimmedValue.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new IdempotencyKeyTooLongError();
    }

    return trimmedValue;
  },
);

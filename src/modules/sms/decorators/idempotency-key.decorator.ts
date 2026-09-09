import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { IdempotencyKeyRequiredException } from '../../../common/exceptions/idempotency-key-required.exception';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH } from '../../../config/constants';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.header(IDEMPOTENCY_KEY_HEADER);

    if (!value || value.trim().length === 0) {
      throw new IdempotencyKeyRequiredException();
    }

    const trimmedValue = value.trim();

    if (trimmedValue.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new IdempotencyKeyRequiredException(
        `X-Idempotency-Key must be shorter than or equal to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
      );
    }

    return trimmedValue;
  },
);

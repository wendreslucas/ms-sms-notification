import { HttpStatus } from '@nestjs/common';

import { ErrorCode, ErrorDefinition } from './error-catalog';

export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

/**
 * Base class for every error the service raises on purpose.
 *
 * It is deliberately framework-neutral: it carries a stable code, the
 * client-safe message from the catalog and the HTTP status to use, and
 * AppErrorFilter turns it into a response. The same class works in the
 * worker, where no HTTP response exists.
 */
export abstract class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: HttpStatus;
  /** Values that vary per occurrence, kept out of the fixed message. */
  readonly details?: ErrorDetails;

  protected constructor(code: ErrorCode, definition: ErrorDefinition, details?: ErrorDetails) {
    super(definition.message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = definition.httpStatus;
    this.details = details;
  }
}

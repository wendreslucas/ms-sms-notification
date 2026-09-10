import { STATUS_CODES } from 'node:http';

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { AppError } from './app-error';
import { ErrorResponseDto } from './error-response.dto';

/**
 * Turns an AppError into the service's error response.
 *
 * Registered through APP_FILTER, so it applies wherever AppModule runs,
 * including the e2e suites, without depending on the bootstrap in main.ts.
 * Errors that are not AppError keep Nest's default handling.
 */
@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter<AppError> {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AppErrorFilter.name);
  }

  catch(error: AppError, host: ArgumentsHost): void {
    const statusCode = error.httpStatus;

    // Client errors are already visible in the request log; only failures on
    // the service's side are worth an error entry of their own.
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ code: error.code, details: error.details }, error.message);
    }

    const body: ErrorResponseDto = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };

    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }
}

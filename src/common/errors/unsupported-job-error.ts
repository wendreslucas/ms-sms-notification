import { AppError } from './app-error';
import { ERROR_CATALOG, ErrorCode } from './error-catalog';

export class UnsupportedJobError extends AppError {
  constructor(jobName: string) {
    super(ErrorCode.QUEUE_UNSUPPORTED_JOB, ERROR_CATALOG[ErrorCode.QUEUE_UNSUPPORTED_JOB], {
      jobName,
    });
  }
}

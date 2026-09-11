import type { SendSmsResult } from './interfaces/sms-provider.interface';

export interface SmsProviderExceptionOptions {
  provider: string;
  providerCode?: string | number;
  message: string;
  httpStatus?: number;
  retryable: boolean;
  retryAfterMs?: number;
  providerMetadata?: Record<string, unknown>;
}

export class SmsProviderException extends Error {
  readonly provider: string;
  readonly providerCode?: string | number;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly providerMetadata?: Record<string, unknown>;

  constructor(options: SmsProviderExceptionOptions) {
    super(options.message);
    this.name = new.target.name;
    this.provider = options.provider;
    this.providerCode = options.providerCode;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.providerMetadata = options.providerMetadata;
  }
}

export function toSendSmsFailureResult(error: SmsProviderException): SendSmsResult {
  return {
    success: false,
    error: error.message,
    isRetryable: error.retryable,
    provider: error.provider,
    ...(error.providerCode !== undefined ? { providerCode: error.providerCode } : {}),
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error.providerMetadata !== undefined ? { providerMetadata: error.providerMetadata } : {}),
  };
}

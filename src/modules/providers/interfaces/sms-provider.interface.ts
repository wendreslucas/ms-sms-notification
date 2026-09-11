export interface SendSmsOptions {
  to: string;
  body: string;
  referenceId: string;
}

export interface SendSmsResult {
  success: boolean;
  providerMessageId?: string;
  provider?: string;
  providerCode?: string | number;
  httpStatus?: number;
  error?: string;
  isRetryable: boolean;
  retryAfterMs?: number;
  providerMetadata?: Record<string, unknown>;
}

export interface ISmsProvider {
  readonly providerName: string;

  sendSms(options: SendSmsOptions): Promise<SendSmsResult>;
}

/** Injection token for the list of every registered ISmsProvider. */
export const SMS_PROVIDERS = 'SMS_PROVIDERS';

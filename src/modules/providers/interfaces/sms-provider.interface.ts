export interface SendSmsOptions {
  to: string;
  body: string;
  referenceId: string;
}

export interface SendSmsResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  isRetryable: boolean;
  retryAfterMs?: number;
}

export interface ISmsProvider {
  readonly providerName: string;

  sendSms(options: SendSmsOptions): Promise<SendSmsResult>;
}

/** Injection token for the list of every registered ISmsProvider. */
export const SMS_PROVIDERS = 'SMS_PROVIDERS';

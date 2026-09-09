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
}

export interface ISmsProvider {
  readonly providerName: string;

  sendSms(options: SendSmsOptions): Promise<SendSmsResult>;
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SendSmsOptions, SendSmsResult, ISmsProvider } from '../interfaces/sms-provider.interface';
import { normalizeTwilioError } from '../provider-error-classifier';
import { SmsProviderName } from '../sms-provider-name.enum';
import {
  TWILIO_CLIENT_FACTORY,
  TwilioClientFactory,
  TwilioMessageClient,
} from './twilio-provider.tokens';

@Injectable()
export class TwilioProvider implements ISmsProvider {
  readonly providerName = SmsProviderName.TWILIO;

  private client: TwilioMessageClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(TWILIO_CLIENT_FACTORY)
    private readonly clientFactory: TwilioClientFactory,
  ) {}

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN') ?? '';
    const from = this.configService.get<string>('TWILIO_PHONE_NUMBER') ?? '';

    if (!accountSid || !authToken || !from) {
      return {
        success: false,
        error: 'Twilio configuration is incomplete.',
        isRetryable: false,
      };
    }

    try {
      const result = await this.getClient(accountSid, authToken).messages.create({
        to: options.to,
        from,
        body: options.body,
      });

      return {
        success: true,
        providerMessageId: result.sid,
        isRetryable: false,
      };
    } catch (error) {
      const normalizedError = normalizeTwilioError(error);

      return {
        success: false,
        error: normalizedError.message,
        isRetryable: normalizedError.isRetryable,
      };
    }
  }

  private getClient(accountSid: string, authToken: string): TwilioMessageClient {
    if (!this.client) {
      this.client = this.clientFactory(accountSid, authToken);
    }

    return this.client;
  }
}

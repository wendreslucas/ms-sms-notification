import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SendSmsOptions, SendSmsResult, ISmsProvider } from '../interfaces/sms-provider.interface';
import { normalizeBirdError } from '../provider-error-classifier';
import { SmsProviderName } from '../sms-provider-name.enum';
import { BIRD_CLIENT_FACTORY, BirdClientFactory, BirdSmsClient } from './bird-provider.tokens';

@Injectable()
export class BirdProvider implements ISmsProvider {
  readonly providerName = SmsProviderName.BIRD;

  private client: BirdSmsClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(BIRD_CLIENT_FACTORY)
    private readonly clientFactory: BirdClientFactory,
  ) {}

  async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
    const apiKey = this.configService.get<string>('BIRD_API_KEY') ?? '';
    const originator = this.configService.get<string>('BIRD_ORIGINATOR') ?? '';

    if (!apiKey || !originator) {
      return {
        success: false,
        error: 'Bird configuration is incomplete.',
        isRetryable: false,
      };
    }

    try {
      const result = await (
        await this.getClient(apiKey)
      ).sms.send(
        {
          to: options.to,
          from: originator,
          text: options.body,
          category: 'transactional',
        },
        {
          idempotencyKey: `sms:${options.referenceId}:${this.providerName}`,
        },
      );

      return {
        success: true,
        providerMessageId: result.id,
        isRetryable: false,
      };
    } catch (error) {
      const normalizedError = normalizeBirdError(error);

      return {
        success: false,
        error: normalizedError.message,
        isRetryable: normalizedError.isRetryable,
        retryAfterMs: normalizedError.retryAfterMs,
      };
    }
  }

  private async getClient(apiKey: string): Promise<BirdSmsClient> {
    if (!this.client) {
      this.client = await this.clientFactory(apiKey);
    }

    return this.client;
  }
}

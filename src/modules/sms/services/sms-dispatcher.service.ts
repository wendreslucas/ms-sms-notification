import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { maskPhoneNumber } from '../../../common/utils/mask-phone-number';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { SendSmsResult } from '../../providers/interfaces/sms-provider.interface';
import { SmsMessage } from '../entities/sms-message.entity';
import { SmsStatus } from '../entities/sms-status.enum';
import { SmsService } from './sms.service';

const TERMINAL_OR_POST_SEND_STATUSES = new Set<SmsStatus>([
  SmsStatus.SENT,
  SmsStatus.DELIVERED,
  SmsStatus.UNDELIVERED,
  SmsStatus.REJECTED,
  SmsStatus.FATAL_FAILURE,
]);

@Injectable()
export class SmsDispatcherService implements OnModuleInit {
  constructor(
    private readonly smsService: SmsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.logger.setContext(SmsDispatcherService.name);
  }

  async dispatch(messageId: string): Promise<void> {
    const message = await this.smsService.findById(messageId);

    if (!message) {
      this.logger.error({ messageId }, 'SMS message referenced by job was not found');
      throw new Error(`SMS message "${messageId}" was not found.`);
    }

    if (this.shouldSkip(message)) {
      this.logger.info(
        {
          event: LogEvent.DUPLICATE_JOB_SKIPPED,
          messageId: message.id,
          status: message.status,
        },
        'SMS job skipped because message is not eligible for dispatch',
      );
      return;
    }

    const transitioned = await this.smsService.markProcessing(message.id);
    if (!transitioned) {
      const latestMessage = await this.smsService.findById(message.id);
      this.logger.info(
        {
          event: LogEvent.DUPLICATE_JOB_SKIPPED,
          messageId: message.id,
          status: latestMessage?.status ?? message.status,
        },
        'SMS job skipped because another worker changed the message state',
      );
      return;
    }

    const attempt = message.attempts + 1;
    const provider = this.providerRegistry.getPrimaryProvider();

    this.logger.info(
      {
        event: LogEvent.PROVIDER_ATTEMPT,
        messageId: message.id,
        provider: provider.providerName,
        attempt,
        phone: maskPhoneNumber(message.recipientPhone),
      },
      'Attempting SMS provider send',
    );

    const result = await this.sendWithProvider(message, provider.providerName);

    if (result.success) {
      await this.smsService.markSent(
        message.id,
        provider.providerName,
        result.providerMessageId ?? null,
      );
      this.logger.info(
        {
          event: LogEvent.MESSAGE_SENT,
          messageId: message.id,
          provider: provider.providerName,
          attempt,
        },
        'SMS message sent',
      );
      return;
    }

    await this.smsService.markFailed(
      message.id,
      provider.providerName,
      result.error ?? 'SMS provider returned an unsuccessful response.',
    );
    this.logger.warn(
      {
        event: LogEvent.MESSAGE_FAILED,
        messageId: message.id,
        provider: provider.providerName,
        attempt,
        retryable: result.isRetryable,
      },
      'SMS provider send failed',
    );
  }

  private shouldSkip(message: SmsMessage): boolean {
    return (
      message.status !== SmsStatus.QUEUED || TERMINAL_OR_POST_SEND_STATUSES.has(message.status)
    );
  }

  private async sendWithProvider(
    message: SmsMessage,
    providerName: string,
  ): Promise<SendSmsResult> {
    const provider = this.providerRegistry.getPrimaryProvider();

    try {
      return await provider.sendSms({
        to: message.recipientPhone,
        body: message.messageBody,
        referenceId: message.id,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : `Provider ${providerName} threw an error.`,
        isRetryable: true,
      };
    }
  }
}

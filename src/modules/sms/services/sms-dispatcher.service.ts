import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { maskPhoneNumber } from '../../../common/utils/mask-phone-number';
import { calculateExponentialBackoff } from '../../../common/utils/retry.util';
import { ISmsProvider, SendSmsResult } from '../../providers/interfaces/sms-provider.interface';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ProviderRateLimiterService } from '../../providers/rate-limiting/provider-rate-limiter.service';
import { QueueService } from '../../queue/queue.service';
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
    private readonly configService: ConfigService,
    private readonly smsService: SmsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly rateLimiter: ProviderRateLimiterService,
    private readonly queueService: QueueService,
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

    await this.dispatchAcrossProviders(message);
  }

  private shouldSkip(message: SmsMessage): boolean {
    return (
      message.status !== SmsStatus.QUEUED || TERMINAL_OR_POST_SEND_STATUSES.has(message.status)
    );
  }

  private async dispatchAcrossProviders(message: SmsMessage): Promise<void> {
    const providers = this.providerRegistry.getProviders();
    const maxAttemptsPerProvider = this.configService.getOrThrow<number>('sms.maxRetries');
    const retryBaseDelayMs = this.configService.getOrThrow<number>('sms.retryBaseDelayMs');
    let totalAttempts = message.attempts;
    let lastProviderName = providers[0]?.providerName ?? 'unknown';
    let lastError = 'No SMS provider is configured.';

    for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
      const provider = providers[providerIndex];

      if (!provider) {
        continue;
      }

      lastProviderName = provider.providerName;

      for (
        let providerAttempt = 1;
        providerAttempt <= maxAttemptsPerProvider;
        providerAttempt += 1
      ) {
        totalAttempts += 1;
        await this.smsService.incrementAttempts(message.id);
        await this.rateLimiter.throttle(provider.providerName);

        this.logger.info(
          {
            event: LogEvent.PROVIDER_ATTEMPT,
            messageId: message.id,
            provider: provider.providerName,
            providerAttempt,
            totalAttempts,
            phone: maskPhoneNumber(message.recipientPhone),
          },
          'Attempting SMS provider send',
        );

        const result = await this.sendWithProvider(message, provider);

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
              providerAttempt,
              totalAttempts,
            },
            'SMS message sent',
          );
          return;
        }

        lastError = result.error ?? 'SMS provider returned an unsuccessful response.';

        if (!result.isRetryable || providerAttempt >= maxAttemptsPerProvider) {
          break;
        }

        const delayMs = Math.max(
          result.retryAfterMs ?? 0,
          calculateExponentialBackoff(providerAttempt, retryBaseDelayMs),
        );

        this.logger.warn(
          {
            event: LogEvent.PROVIDER_RETRY,
            messageId: message.id,
            provider: provider.providerName,
            providerAttempt,
            nextProviderAttempt: providerAttempt + 1,
            totalAttempts,
            delayMs,
            retryable: result.isRetryable,
          },
          'SMS provider send will be retried',
        );

        await this.sleep(delayMs);
      }

      const nextProvider = providers[providerIndex + 1];

      if (nextProvider) {
        this.logger.warn(
          {
            event: LogEvent.PROVIDER_FAILOVER,
            messageId: message.id,
            fromProvider: provider.providerName,
            toProvider: nextProvider.providerName,
            totalAttempts,
          },
          'SMS provider failover started',
        );
      }
    }

    await this.smsService.markFatalFailure(message.id, lastProviderName, lastError);
    this.logger.warn(
      {
        event: LogEvent.MESSAGE_FAILED,
        messageId: message.id,
        provider: lastProviderName,
        attempts: totalAttempts,
        error: lastError,
      },
      'SMS message reached fatal failure after all configured providers were exhausted',
    );

    try {
      await this.queueService.enqueueDeadLetter(message.id);
    } catch (error) {
      this.logger.error(
        {
          event: LogEvent.DLQ_PUBLISH_FAILED,
          messageId: message.id,
          status: SmsStatus.FATAL_FAILURE,
          attempts: totalAttempts,
          err: error instanceof Error ? error.message : 'Unknown DLQ publication error',
        },
        'Failed to publish SMS message to DLQ',
      );
      throw error;
    }

    this.logger.warn(
      {
        event: LogEvent.MESSAGE_DLQ,
        messageId: message.id,
        status: SmsStatus.FATAL_FAILURE,
        attempts: totalAttempts,
      },
      'SMS message published to DLQ',
    );
  }

  private async sendWithProvider(
    message: SmsMessage,
    provider: ISmsProvider,
  ): Promise<SendSmsResult> {
    try {
      return await provider.sendSms({
        to: message.recipientPhone,
        body: message.messageBody,
        referenceId: message.id,
      });
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : `Provider ${provider.providerName} threw an error.`,
        isRetryable: true,
      };
    }
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

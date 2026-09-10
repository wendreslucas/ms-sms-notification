import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { SmsService } from '../../sms/services/sms.service';
import {
  allowedPreviousStatusesFor,
  classifySkippedCallback,
  isDeliveryFailureStatus,
} from '../status/delivery-status-policy';

export interface DeliveryStatusCallback {
  provider: string;
  providerMessageId: string;
  status: SmsStatus;
  externalStatus: string;
  eventAt: Date | null;
  lastError: string | null;
}

export type DeliveryStatusOutcome = 'UPDATED' | 'DUPLICATE' | 'IGNORED' | 'CONFLICT' | 'NOT_FOUND';

@Injectable()
export class DeliveryStatusService implements OnModuleInit {
  constructor(
    private readonly smsService: SmsService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.logger.setContext(DeliveryStatusService.name);
  }

  /**
   * Applies a normalized delivery status to the stored message.
   *
   * The write is a single conditional UPDATE, so duplicate callbacks and
   * callbacks that arrive out of order neither regress the status nor produce
   * extra side effects.
   */
  async apply(callback: DeliveryStatusCallback): Promise<DeliveryStatusOutcome> {
    const message = await this.smsService.findByProviderMessageId(
      callback.provider,
      callback.providerMessageId,
    );

    if (!message) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_MESSAGE_NOT_FOUND,
          provider: callback.provider,
          providerMessageId: callback.providerMessageId,
          externalStatus: callback.externalStatus,
        },
        'Delivery callback referenced an unknown provider message id',
      );

      return 'NOT_FOUND';
    }

    const allowedPreviousStatuses = allowedPreviousStatusesFor(callback.status);

    if (!allowedPreviousStatuses) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_STATUS_IGNORED,
          provider: callback.provider,
          messageId: message.id,
          providerMessageId: callback.providerMessageId,
          previousStatus: message.status,
          newStatus: callback.status,
          externalStatus: callback.externalStatus,
        },
        'Delivery callback mapped to a status that cannot be applied from a webhook',
      );

      return 'IGNORED';
    }

    const previousStatus = message.status;
    const eventAt = callback.eventAt ?? new Date();
    const updated = await this.smsService.applyDeliveryStatus({
      messageId: message.id,
      status: callback.status,
      allowedPreviousStatuses,
      lastError: callback.lastError,
      ...this.buildTimestamps(callback.status, eventAt),
    });

    if (updated) {
      this.logger.info(
        {
          event: LogEvent.WEBHOOK_STATUS_UPDATED,
          provider: callback.provider,
          messageId: message.id,
          providerMessageId: callback.providerMessageId,
          previousStatus,
          newStatus: callback.status,
          externalStatus: callback.externalStatus,
        },
        'SMS delivery status updated from provider callback',
      );

      return 'UPDATED';
    }

    return this.logSkippedCallback(callback, message.id, previousStatus);
  }

  private buildTimestamps(
    status: SmsStatus,
    eventAt: Date,
  ): { deliveredAt?: Date | null; failedAt?: Date | null; sentAtWhenMissing?: Date } {
    if (status === SmsStatus.DELIVERED) {
      // The delivery succeeded, so any failure timestamp recorded by an earlier
      // non-delivery receipt no longer describes the message.
      return { deliveredAt: eventAt, failedAt: null };
    }

    if (isDeliveryFailureStatus(status)) {
      // sentAt is left untouched: the provider may well have accepted and sent
      // the message before delivery failed.
      return { failedAt: eventAt };
    }

    return { sentAtWhenMissing: eventAt };
  }

  private async logSkippedCallback(
    callback: DeliveryStatusCallback,
    messageId: string,
    previousStatus: SmsStatus,
  ): Promise<DeliveryStatusOutcome> {
    const latestMessage = await this.smsService.findById(messageId);
    const currentStatus = latestMessage?.status ?? previousStatus;
    const reason = classifySkippedCallback(currentStatus, callback.status);

    const logPayload = {
      provider: callback.provider,
      messageId,
      providerMessageId: callback.providerMessageId,
      previousStatus: currentStatus,
      newStatus: callback.status,
      externalStatus: callback.externalStatus,
    };

    if (reason === 'CONFLICT') {
      this.logger.warn(
        { ...logPayload, event: LogEvent.WEBHOOK_STATUS_CONFLICT },
        'Conflicting terminal delivery callback ignored to protect the recorded outcome',
      );

      return 'CONFLICT';
    }

    if (reason === 'DUPLICATE') {
      this.logger.info(
        { ...logPayload, event: LogEvent.WEBHOOK_DUPLICATE },
        'Delivery callback repeated a status that is already recorded',
      );

      return 'DUPLICATE';
    }

    this.logger.info(
      { ...logPayload, event: LogEvent.WEBHOOK_STATUS_IGNORED },
      'Delivery callback ignored because it would regress the recorded status',
    );

    return 'IGNORED';
  }
}

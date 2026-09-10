import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { BirdSignatureVerifier } from '../signature/bird-signature.verifier';
import { mapBirdEventType } from '../status/bird-status.mapper';
import {
  BirdDeliveryEvent,
  buildBirdLastError,
  extractBirdDeliveryEvent,
} from '../types/bird-webhook-event';
import { DeliveryStatusService } from './delivery-status.service';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

@Injectable()
export class BirdWebhookService implements OnModuleInit {
  constructor(
    private readonly signatureVerifier: BirdSignatureVerifier,
    private readonly webhookIdempotencyService: WebhookIdempotencyService,
    private readonly deliveryStatusService: DeliveryStatusService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.logger.setContext(BirdWebhookService.name);
  }

  /**
   * Handles a Bird webhook event.
   *
   * Verification runs over the raw request bytes, the delivery is deduplicated
   * on `webhook-id`, and the status update itself is idempotent, so neither a
   * retry nor a lost deduplication claim can corrupt the recorded status.
   */
  async handle(rawBody: Buffer | undefined, headers: Record<string, unknown>): Promise<void> {
    const verification = await this.signatureVerifier.verify(rawBody, headers);

    if (!verification.ok) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_SIGNATURE_INVALID,
          provider: SmsProviderName.BIRD,
          reason: verification.reason,
        },
        'Rejected Bird webhook that failed verification',
      );

      throw new ForbiddenException('Invalid Bird webhook signature.');
    }

    const event = extractBirdDeliveryEvent(verification.event);

    if (!event) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_PAYLOAD_INVALID,
          provider: SmsProviderName.BIRD,
          webhookId: verification.webhookId,
        },
        'Rejected Bird webhook without an event type or sms id',
      );

      throw new BadRequestException('Bird webhook is missing the event type or sms id.');
    }

    this.logger.info(
      {
        event: LogEvent.WEBHOOK_RECEIVED,
        provider: SmsProviderName.BIRD,
        webhookId: verification.webhookId,
        providerMessageId: event.smsId,
        externalStatus: event.type,
      },
      'Bird delivery event received',
    );

    const claimed = await this.webhookIdempotencyService.claimBirdWebhook(verification.webhookId);

    if (!claimed) {
      this.logger.info(
        {
          event: LogEvent.WEBHOOK_DUPLICATE,
          provider: SmsProviderName.BIRD,
          webhookId: verification.webhookId,
          providerMessageId: event.smsId,
          externalStatus: event.type,
        },
        'Bird webhook delivery was already processed',
      );

      return;
    }

    try {
      await this.processEvent(event);
    } catch (error) {
      // Release the claim so a Bird retry can be processed again; the underlying
      // status update stays idempotent either way.
      await this.releaseClaim(verification.webhookId);
      throw error;
    }
  }

  private async processEvent(event: BirdDeliveryEvent): Promise<void> {
    const status = mapBirdEventType(event.type);

    if (!status) {
      this.logger.info(
        {
          event: LogEvent.WEBHOOK_STATUS_IGNORED,
          provider: SmsProviderName.BIRD,
          providerMessageId: event.smsId,
          externalStatus: event.type,
        },
        'Bird event carries no actionable delivery status',
      );

      return;
    }

    await this.deliveryStatusService.apply({
      provider: SmsProviderName.BIRD,
      providerMessageId: event.smsId,
      status,
      externalStatus: event.type,
      eventAt: event.occurredAt,
      lastError: this.buildLastError(status, event),
    });
  }

  private buildLastError(status: SmsStatus, event: BirdDeliveryEvent): string | null {
    if (status === SmsStatus.DELIVERED || status === SmsStatus.SENT) {
      return null;
    }

    return buildBirdLastError(event);
  }

  private async releaseClaim(webhookId: string): Promise<void> {
    try {
      await this.webhookIdempotencyService.releaseBirdWebhook(webhookId);
    } catch (error) {
      this.logger.warn(
        {
          provider: SmsProviderName.BIRD,
          webhookId,
          err: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to release Bird webhook deduplication claim',
      );
    }
  }
}

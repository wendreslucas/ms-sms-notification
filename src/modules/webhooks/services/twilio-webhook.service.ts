import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { InvalidTwilioPayloadError } from '../../../common/errors/invalid-twilio-payload-error';
import { InvalidTwilioSignatureError } from '../../../common/errors/invalid-twilio-signature-error';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { TwilioSignatureVerifier } from '../signature/twilio-signature.verifier';
import { mapTwilioStatus } from '../status/twilio-status.mapper';
import {
  buildTwilioLastError,
  extractTwilioStatusCallback,
  TwilioStatusCallback,
} from '../types/twilio-status-callback';
import { DeliveryStatusService } from './delivery-status.service';

@Injectable()
export class TwilioWebhookService implements OnModuleInit {
  constructor(
    private readonly signatureVerifier: TwilioSignatureVerifier,
    private readonly deliveryStatusService: DeliveryStatusService,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.logger.setContext(TwilioWebhookService.name);
  }

  /**
   * Handles a Twilio status callback.
   *
   * Twilio has no delivery id to deduplicate on, so idempotency comes entirely
   * from the conditional status update: replaying `delivered` leaves the message
   * DELIVERED with no additional side effects.
   */
  async handle(signature: string | undefined, body: Record<string, unknown>): Promise<void> {
    if (!this.signatureVerifier.verify(signature, body)) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_SIGNATURE_INVALID,
          provider: SmsProviderName.TWILIO,
          signaturePresent: Boolean(signature),
        },
        'Rejected Twilio callback with an invalid signature',
      );

      throw new InvalidTwilioSignatureError();
    }

    const callback = extractTwilioStatusCallback(body);

    if (!callback) {
      this.logger.warn(
        {
          event: LogEvent.WEBHOOK_PAYLOAD_INVALID,
          provider: SmsProviderName.TWILIO,
        },
        'Rejected Twilio callback without MessageSid or MessageStatus',
      );

      throw new InvalidTwilioPayloadError();
    }

    this.logger.info(
      {
        event: LogEvent.WEBHOOK_RECEIVED,
        provider: SmsProviderName.TWILIO,
        providerMessageId: callback.messageSid,
        externalStatus: callback.messageStatus,
      },
      'Twilio delivery callback received',
    );

    const status = mapTwilioStatus(callback.messageStatus);

    if (!status) {
      this.logger.info(
        {
          event: LogEvent.WEBHOOK_STATUS_IGNORED,
          provider: SmsProviderName.TWILIO,
          providerMessageId: callback.messageSid,
          externalStatus: callback.messageStatus,
        },
        'Twilio callback carries no actionable delivery status',
      );

      return;
    }

    await this.deliveryStatusService.apply({
      provider: SmsProviderName.TWILIO,
      providerMessageId: callback.messageSid,
      status,
      externalStatus: callback.messageStatus,
      eventAt: null,
      lastError: this.buildLastError(status, callback),
    });
  }

  private buildLastError(status: SmsStatus, callback: TwilioStatusCallback): string | null {
    if (status === SmsStatus.DELIVERED || status === SmsStatus.SENT) {
      return null;
    }

    return buildTwilioLastError(callback);
  }
}

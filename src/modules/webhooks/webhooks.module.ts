import { Module } from '@nestjs/common';

import { SmsModule } from '../sms/sms.module';
import { BirdWebhookController } from './controllers/bird-webhook.controller';
import { TwilioWebhookController } from './controllers/twilio-webhook.controller';
import { BirdSignatureVerifier } from './signature/bird-signature.verifier';
import {
  BIRD_WEBHOOK_CLIENT_FACTORY,
  defaultBirdWebhookClientFactory,
} from './signature/bird-webhook-client.tokens';
import { TwilioSignatureVerifier } from './signature/twilio-signature.verifier';
import { BirdWebhookService } from './services/bird-webhook.service';
import { DeliveryStatusService } from './services/delivery-status.service';
import { TwilioWebhookService } from './services/twilio-webhook.service';
import { WebhookIdempotencyService } from './services/webhook-idempotency.service';

@Module({
  imports: [SmsModule],
  controllers: [TwilioWebhookController, BirdWebhookController],
  providers: [
    {
      provide: BIRD_WEBHOOK_CLIENT_FACTORY,
      useValue: defaultBirdWebhookClientFactory,
    },
    TwilioSignatureVerifier,
    BirdSignatureVerifier,
    WebhookIdempotencyService,
    DeliveryStatusService,
    TwilioWebhookService,
    BirdWebhookService,
  ],
})
export class WebhooksModule {}

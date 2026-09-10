import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BIRD_WEBHOOK_ID_HEADER,
  BIRD_WEBHOOK_SIGNATURE_HEADER,
  BIRD_WEBHOOK_TIMESTAMP_HEADER,
} from '../webhooks.constants';
import {
  BIRD_WEBHOOK_CLIENT_FACTORY,
  BirdWebhookClientFactory,
  BirdWebhookUnwrapper,
} from './bird-webhook-client.tokens';

export type BirdVerificationFailure =
  | 'SECRET_NOT_CONFIGURED'
  | 'MISSING_RAW_BODY'
  | 'MISSING_HEADERS'
  | 'INVALID_TIMESTAMP'
  | 'TIMESTAMP_OUT_OF_TOLERANCE'
  | 'INVALID_SIGNATURE';

export type BirdVerificationResult =
  { ok: true; webhookId: string; event: unknown } | { ok: false; reason: BirdVerificationFailure };

@Injectable()
export class BirdSignatureVerifier {
  private unwrapper: BirdWebhookUnwrapper | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(BIRD_WEBHOOK_CLIENT_FACTORY)
    private readonly clientFactory: BirdWebhookClientFactory,
  ) {}

  /**
   * Verifies a Bird delivery following the Standard Webhooks specification.
   *
   * The signature covers `{webhook-id}.{webhook-timestamp}.{raw body}`, so the
   * untouched request bytes are passed straight to the official SDK. Re-encoding
   * the parsed JSON here would change those bytes and break verification.
   *
   * The replay window is checked explicitly against BIRD_WEBHOOK_TOLERANCE_SECONDS
   * before delegating; the SDK additionally enforces the 5 minute window defined
   * by the specification, so a larger configured value never widens it.
   */
  async verify(
    rawBody: Buffer | undefined,
    headers: Record<string, unknown>,
  ): Promise<BirdVerificationResult> {
    const secret = this.configService.get<string>('webhooks.bird.secret') ?? '';

    if (!secret) {
      return { ok: false, reason: 'SECRET_NOT_CONFIGURED' };
    }

    if (!rawBody || rawBody.length === 0) {
      return { ok: false, reason: 'MISSING_RAW_BODY' };
    }

    const webhookId = this.readHeader(headers, BIRD_WEBHOOK_ID_HEADER);
    const webhookTimestamp = this.readHeader(headers, BIRD_WEBHOOK_TIMESTAMP_HEADER);
    const webhookSignature = this.readHeader(headers, BIRD_WEBHOOK_SIGNATURE_HEADER);

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return { ok: false, reason: 'MISSING_HEADERS' };
    }

    const timestampFailure = this.verifyTimestamp(webhookTimestamp);

    if (timestampFailure) {
      return { ok: false, reason: timestampFailure };
    }

    try {
      const unwrapper = await this.getUnwrapper(secret);
      const event = unwrapper.unwrap(rawBody.toString('utf8'), {
        [BIRD_WEBHOOK_ID_HEADER]: webhookId,
        [BIRD_WEBHOOK_TIMESTAMP_HEADER]: webhookTimestamp,
        [BIRD_WEBHOOK_SIGNATURE_HEADER]: webhookSignature,
      });

      return { ok: true, webhookId, event };
    } catch {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }
  }

  private verifyTimestamp(webhookTimestamp: string): BirdVerificationFailure | null {
    const timestampSeconds = Number.parseInt(webhookTimestamp, 10);

    if (!Number.isFinite(timestampSeconds)) {
      return 'INVALID_TIMESTAMP';
    }

    const toleranceSeconds =
      this.configService.get<number>('webhooks.bird.toleranceSeconds') ?? 300;
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
      return 'TIMESTAMP_OUT_OF_TOLERANCE';
    }

    return null;
  }

  private async getUnwrapper(secret: string): Promise<BirdWebhookUnwrapper> {
    if (!this.unwrapper) {
      this.unwrapper = await this.clientFactory(secret);
    }

    return this.unwrapper;
  }

  private readHeader(headers: Record<string, unknown>, name: string): string | null {
    const value = headers[name] ?? headers[name.toLowerCase()];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
      return value[0].trim();
    }

    return null;
  }
}

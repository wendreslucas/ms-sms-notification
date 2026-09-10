import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { BIRD_WEBHOOK_IDEMPOTENCY_KEY_PREFIX } from '../webhooks.constants';

@Injectable()
export class WebhookIdempotencyService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.getOrThrow<string>('redis.host'),
      port: this.configService.getOrThrow<number>('redis.port'),
      maxRetriesPerRequest: 3,
    });
    this.ttlSeconds = this.configService.get<number>('webhooks.idempotencyTtlSeconds') ?? 86400;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  buildBirdKey(webhookId: string): string {
    return `${BIRD_WEBHOOK_IDEMPOTENCY_KEY_PREFIX}:${webhookId}`;
  }

  /**
   * Claims a Bird `webhook-id` for processing. Bird delivers at-least-once, so
   * the same delivery can arrive more than once, including concurrently. Only
   * the first claim wins.
   *
   * This is a fast path, not the consistency guarantee: the database update is
   * itself idempotent, so a lost or expired claim cannot corrupt the stored
   * status.
   */
  async claimBirdWebhook(webhookId: string): Promise<boolean> {
    const result = await this.redis.set(
      this.buildBirdKey(webhookId),
      '1',
      'EX',
      this.ttlSeconds,
      'NX',
    );

    return result === 'OK';
  }

  async releaseBirdWebhook(webhookId: string): Promise<void> {
    await this.redis.del(this.buildBirdKey(webhookId));
  }
}

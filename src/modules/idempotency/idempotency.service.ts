import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface IdempotencyLock {
  key: string;
  token: string;
}

@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  private readonly lockTtlSeconds = 30;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.getOrThrow<string>('redis.host'),
      port: this.configService.getOrThrow<number>('redis.port'),
      maxRetriesPerRequest: 3,
    });
    this.ttlSeconds = this.configService.getOrThrow<number>('sms.idempotencyTtlSeconds');
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  buildCacheKey(idempotencyKey: string): string {
    return `sms:idempotency:${idempotencyKey}`;
  }

  buildLockKey(idempotencyKey: string): string {
    return `sms:idempotency-lock:${idempotencyKey}`;
  }

  async getMessageId(idempotencyKey: string): Promise<string | null> {
    return this.redis.get(this.buildCacheKey(idempotencyKey));
  }

  async storeMessageId(idempotencyKey: string, messageId: string): Promise<void> {
    await this.redis.set(this.buildCacheKey(idempotencyKey), messageId, 'EX', this.ttlSeconds);
  }

  async deleteMessageId(idempotencyKey: string): Promise<void> {
    await this.redis.del(this.buildCacheKey(idempotencyKey));
  }

  async acquireLock(idempotencyKey: string): Promise<IdempotencyLock | null> {
    const lock: IdempotencyLock = {
      key: this.buildLockKey(idempotencyKey),
      token: randomUUID(),
    };

    const result = await this.redis.set(lock.key, lock.token, 'EX', this.lockTtlSeconds, 'NX');

    return result === 'OK' ? lock : null;
  }

  async releaseLock(lock: IdempotencyLock): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock.key,
      lock.token,
    );
  }
}

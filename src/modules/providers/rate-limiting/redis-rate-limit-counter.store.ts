import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import {
  RateLimitCounterResult,
  RateLimitCounterStore,
} from './rate-limit-counter-store.interface';

const INCREMENT_WITH_TTL_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

@Injectable()
export class RedisRateLimitCounterStore implements RateLimitCounterStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.getOrThrow<string>('redis.host'),
      port: this.configService.getOrThrow<number>('redis.port'),
      maxRetriesPerRequest: 3,
    });
  }

  async increment(key: string, durationMs: number): Promise<RateLimitCounterResult> {
    const result = await this.redis.eval(INCREMENT_WITH_TTL_SCRIPT, 1, key, durationMs.toString());

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis rate-limit script returned an unexpected response.');
    }

    return {
      count: this.toNumber(result[0]),
      ttlMs: Math.max(this.toNumber(result[1]), 1),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      return Number(value);
    }

    throw new Error('Redis rate-limit script returned a non-numeric value.');
  }
}

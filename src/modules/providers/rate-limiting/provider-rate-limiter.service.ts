import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RateLimitNotConfiguredError } from '../../../common/errors/rate-limit-not-configured-error';
import { ProviderRegistryService } from '../provider-registry.service';
import {
  RATE_LIMIT_COUNTER_STORE,
  RateLimitCounterStore,
} from './rate-limit-counter-store.interface';

export interface ProviderRateLimitConfig {
  max: number;
  durationMs: number;
}

@Injectable()
export class ProviderRateLimiterService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    @Inject(RATE_LIMIT_COUNTER_STORE)
    private readonly counterStore: RateLimitCounterStore,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  /**
   * A provider without limits would otherwise fail only on its first send:
   * for a fallback provider, that is in the middle of an incident, and outside
   * the dispatcher's per-send error handling. Checking every configured
   * provider here turns it into a startup error.
   */
  onModuleInit(): void {
    for (const providerName of this.providerRegistry.getConfiguredProviderNames()) {
      this.getLimitConfig(providerName);
    }
  }

  getLimitConfig(providerName: string): ProviderRateLimitConfig {
    const max = this.configService.get<number>(`providers.${providerName}.rateLimitMax`);
    const durationMs = this.configService.get<number>(
      `providers.${providerName}.rateLimitDurationMs`,
    );

    if (!isPositiveInteger(max) || !isPositiveInteger(durationMs)) {
      throw new RateLimitNotConfiguredError(providerName);
    }

    return { max, durationMs };
  }

  async throttle(providerName: string): Promise<void> {
    const limit = this.getLimitConfig(providerName);

    while (true) {
      const bucket = Math.floor(Date.now() / limit.durationMs);
      const key = `sms:rate-limit:${providerName}:${bucket}`;
      const counter = await this.counterStore.increment(key, limit.durationMs);

      if (counter.count <= limit.max) {
        return;
      }

      await this.sleep(counter.ttlMs);
    }
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UnknownProviderError } from '../../../common/errors/unknown-provider-error';
import { SmsProviderName } from '../sms-provider-name.enum';
import {
  RATE_LIMIT_COUNTER_STORE,
  RateLimitCounterStore,
} from './rate-limit-counter-store.interface';

export interface ProviderRateLimitConfig {
  max: number;
  durationMs: number;
}

@Injectable()
export class ProviderRateLimiterService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(RATE_LIMIT_COUNTER_STORE)
    private readonly counterStore: RateLimitCounterStore,
  ) {}

  getLimitConfig(providerName: string): ProviderRateLimitConfig {
    const providerKey = this.toProviderKey(providerName);

    return {
      max: this.configService.getOrThrow<number>(`providers.${providerKey}.rateLimitMax`),
      durationMs: this.configService.getOrThrow<number>(
        `providers.${providerKey}.rateLimitDurationMs`,
      ),
    };
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

  private toProviderKey(providerName: string): SmsProviderName {
    if (providerName === SmsProviderName.TWILIO) {
      return SmsProviderName.TWILIO;
    }

    if (providerName === SmsProviderName.BIRD) {
      return SmsProviderName.BIRD;
    }

    throw new UnknownProviderError(providerName);
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

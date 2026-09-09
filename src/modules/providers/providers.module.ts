import { Module } from '@nestjs/common';

import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRateLimiterService } from './rate-limiting/provider-rate-limiter.service';
import { RATE_LIMIT_COUNTER_STORE } from './rate-limiting/rate-limit-counter-store.interface';
import { RedisRateLimitCounterStore } from './rate-limiting/redis-rate-limit-counter.store';
import { BIRD_CLIENT_FACTORY, defaultBirdClientFactory } from './strategies/bird-provider.tokens';
import { BirdProvider } from './strategies/bird.provider';
import {
  defaultTwilioClientFactory,
  TWILIO_CLIENT_FACTORY,
} from './strategies/twilio-provider.tokens';
import { TwilioProvider } from './strategies/twilio.provider';

@Module({
  providers: [
    {
      provide: TWILIO_CLIENT_FACTORY,
      useValue: defaultTwilioClientFactory,
    },
    {
      provide: BIRD_CLIENT_FACTORY,
      useValue: defaultBirdClientFactory,
    },
    TwilioProvider,
    BirdProvider,
    {
      provide: RATE_LIMIT_COUNTER_STORE,
      useClass: RedisRateLimitCounterStore,
    },
    ProviderRateLimiterService,
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService, ProviderRateLimiterService],
})
export class ProvidersModule {}

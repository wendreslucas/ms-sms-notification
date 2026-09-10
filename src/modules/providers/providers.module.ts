import { Module, Type } from '@nestjs/common';

import { ISmsProvider, SMS_PROVIDERS } from './interfaces/sms-provider.interface';
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

/**
 * Every SMS provider the service can dispatch through. Adding one means
 * implementing ISmsProvider and listing its class here; which providers are
 * used, and in which order, comes from SMS_PROVIDER_PRIORITY.
 */
const SMS_PROVIDER_STRATEGIES: Type<ISmsProvider>[] = [TwilioProvider, BirdProvider];

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
    ...SMS_PROVIDER_STRATEGIES,
    {
      provide: SMS_PROVIDERS,
      useFactory: (...providers: ISmsProvider[]): ISmsProvider[] => providers,
      inject: SMS_PROVIDER_STRATEGIES,
    },
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

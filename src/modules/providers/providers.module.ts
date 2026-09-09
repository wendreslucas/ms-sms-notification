import { Module } from '@nestjs/common';

import { ProviderRegistryService } from './provider-registry.service';
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
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}

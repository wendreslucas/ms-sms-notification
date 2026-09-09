import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ISmsProvider } from './interfaces/sms-provider.interface';
import { SmsProviderName } from './sms-provider-name.enum';
import { BirdProvider } from './strategies/bird.provider';
import { TwilioProvider } from './strategies/twilio.provider';

@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly providers: Map<SmsProviderName, ISmsProvider>;
  private orderedProviders: ISmsProvider[] = [];

  constructor(
    private readonly configService: ConfigService,
    twilioProvider: TwilioProvider,
    birdProvider: BirdProvider,
  ) {
    this.providers = new Map<SmsProviderName, ISmsProvider>([
      [SmsProviderName.TWILIO, twilioProvider],
      [SmsProviderName.BIRD, birdProvider],
    ]);
  }

  onModuleInit(): void {
    this.orderedProviders = this.resolveConfiguredProviders();
  }

  getConfiguredProviderNames(): SmsProviderName[] {
    const rawValue = this.configService.getOrThrow<string>('sms.providerPriority');
    const providerNames = rawValue
      .split(',')
      .map((providerName) => providerName.trim())
      .filter((providerName) => providerName.length > 0);

    if (providerNames.length === 0) {
      throw new Error('SMS_PROVIDER_PRIORITY must contain at least one provider.');
    }

    return providerNames.map((providerName) => this.toProviderName(providerName));
  }

  getProviders(): ISmsProvider[] {
    return [...this.orderedProviders];
  }

  getPrimaryProvider(): ISmsProvider {
    const provider = this.orderedProviders[0];

    if (!provider) {
      throw new Error('No SMS provider is configured.');
    }

    return provider;
  }

  getProvider(providerName: SmsProviderName): ISmsProvider {
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`SMS provider "${providerName}" is not registered.`);
    }

    return provider;
  }

  private resolveConfiguredProviders(): ISmsProvider[] {
    return this.getConfiguredProviderNames().map((providerName) => this.getProvider(providerName));
  }

  private toProviderName(providerName: string): SmsProviderName {
    if (providerName === SmsProviderName.TWILIO) {
      return SmsProviderName.TWILIO;
    }

    if (providerName === SmsProviderName.BIRD) {
      return SmsProviderName.BIRD;
    }

    throw new Error(`Unknown SMS provider configured: "${providerName}".`);
  }
}

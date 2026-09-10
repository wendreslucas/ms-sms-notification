import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DuplicateProviderError } from '../../common/errors/duplicate-provider-error';
import { NoProviderConfiguredError } from '../../common/errors/no-provider-configured-error';
import { ProviderNotRegisteredError } from '../../common/errors/provider-not-registered-error';
import { ProviderPriorityEmptyError } from '../../common/errors/provider-priority-empty-error';
import { UnknownProviderError } from '../../common/errors/unknown-provider-error';
import { ISmsProvider, SMS_PROVIDERS } from './interfaces/sms-provider.interface';

/**
 * Holds every registered provider under its own `providerName` and resolves
 * the ones SMS_PROVIDER_PRIORITY selects, in that order. It knows no vendor:
 * providers reach it through the SMS_PROVIDERS token.
 */
@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly providers = new Map<string, ISmsProvider>();
  private orderedProviders: ISmsProvider[] = [];

  constructor(
    private readonly configService: ConfigService,
    @Inject(SMS_PROVIDERS) providers: ISmsProvider[],
  ) {
    for (const provider of providers) {
      if (this.providers.has(provider.providerName)) {
        throw new DuplicateProviderError(provider.providerName);
      }

      this.providers.set(provider.providerName, provider);
    }
  }

  onModuleInit(): void {
    this.orderedProviders = this.resolveConfiguredProviders();
  }

  getConfiguredProviderNames(): string[] {
    const rawValue = this.configService.getOrThrow<string>('sms.providerPriority');
    const providerNames = rawValue
      .split(',')
      .map((providerName) => providerName.trim())
      .filter((providerName) => providerName.length > 0);

    if (providerNames.length === 0) {
      throw new ProviderPriorityEmptyError();
    }

    const unknownProviderName = providerNames.find(
      (providerName) => !this.providers.has(providerName),
    );

    if (unknownProviderName !== undefined) {
      throw new UnknownProviderError(unknownProviderName);
    }

    return providerNames;
  }

  getProviders(): ISmsProvider[] {
    return [...this.orderedProviders];
  }

  getPrimaryProvider(): ISmsProvider {
    const provider = this.orderedProviders[0];

    if (!provider) {
      throw new NoProviderConfiguredError();
    }

    return provider;
  }

  getProvider(providerName: string): ISmsProvider {
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new ProviderNotRegisteredError(providerName);
    }

    return provider;
  }

  private resolveConfiguredProviders(): ISmsProvider[] {
    return this.getConfiguredProviderNames().map((providerName) => this.getProvider(providerName));
  }
}

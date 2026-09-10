import { ConfigService } from '@nestjs/config';

import { ProviderPriorityEmptyError } from '../../common/errors/provider-priority-empty-error';
import { UnknownProviderError } from '../../common/errors/unknown-provider-error';
import { ISmsProvider } from './interfaces/sms-provider.interface';
import { ProviderRegistryService } from './provider-registry.service';
import { SmsProviderName } from './sms-provider-name.enum';
import { BirdProvider } from './strategies/bird.provider';
import { TwilioProvider } from './strategies/twilio.provider';

function buildProvider(providerName: SmsProviderName): ISmsProvider {
  return {
    providerName,
    sendSms: jest.fn(),
  };
}

function buildRegistry(priority: string): ProviderRegistryService {
  const configService = {
    getOrThrow: () => priority,
  } as unknown as ConfigService;

  return new ProviderRegistryService(
    configService,
    buildProvider(SmsProviderName.TWILIO) as TwilioProvider,
    buildProvider(SmsProviderName.BIRD) as BirdProvider,
  );
}

describe('ProviderRegistryService', () => {
  it('resolves twilio,bird order', () => {
    const registry = buildRegistry('twilio,bird');
    registry.onModuleInit();

    expect(registry.getProviders().map((provider) => provider.providerName)).toEqual([
      SmsProviderName.TWILIO,
      SmsProviderName.BIRD,
    ]);
    expect(registry.getPrimaryProvider().providerName).toBe(SmsProviderName.TWILIO);
  });

  it('resolves bird,twilio order', () => {
    const registry = buildRegistry('bird,twilio');
    registry.onModuleInit();

    expect(registry.getProviders().map((provider) => provider.providerName)).toEqual([
      SmsProviderName.BIRD,
      SmsProviderName.TWILIO,
    ]);
    expect(registry.getPrimaryProvider().providerName).toBe(SmsProviderName.BIRD);
  });

  it('rejects unknown providers', () => {
    const registry = buildRegistry('foo,twilio');

    expect(() => registry.onModuleInit()).toThrow(UnknownProviderError);
  });

  it('rejects empty configuration', () => {
    const registry = buildRegistry(' , ');

    expect(() => registry.onModuleInit()).toThrow(ProviderPriorityEmptyError);
  });
});

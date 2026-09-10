import { ConfigService } from '@nestjs/config';

import { DuplicateProviderError } from '../../common/errors/duplicate-provider-error';
import { ProviderPriorityEmptyError } from '../../common/errors/provider-priority-empty-error';
import { UnknownProviderError } from '../../common/errors/unknown-provider-error';
import { ISmsProvider } from './interfaces/sms-provider.interface';
import { ProviderRegistryService } from './provider-registry.service';
import { SmsProviderName } from './sms-provider-name.enum';

const BUILT_IN_PROVIDERS: string[] = [SmsProviderName.TWILIO, SmsProviderName.BIRD];

function buildProvider(providerName: string): ISmsProvider {
  return {
    providerName,
    sendSms: jest.fn(),
  };
}

function buildRegistry(
  priority: string,
  providerNames: string[] = BUILT_IN_PROVIDERS,
): ProviderRegistryService {
  const configService = {
    getOrThrow: () => priority,
  } as unknown as ConfigService;

  return new ProviderRegistryService(
    configService,
    providerNames.map((providerName) => buildProvider(providerName)),
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

  it('resolves a newly registered provider by its own name, with no change to the registry', () => {
    const registry = buildRegistry('example,twilio', [...BUILT_IN_PROVIDERS, 'example']);
    registry.onModuleInit();

    expect(registry.getProviders().map((provider) => provider.providerName)).toEqual([
      'example',
      SmsProviderName.TWILIO,
    ]);
    expect(registry.getPrimaryProvider().providerName).toBe('example');
  });

  it('rejects unknown providers', () => {
    const registry = buildRegistry('foo,twilio');

    expect(() => registry.onModuleInit()).toThrow(UnknownProviderError);
  });

  it('rejects empty configuration', () => {
    const registry = buildRegistry(' , ');

    expect(() => registry.onModuleInit()).toThrow(ProviderPriorityEmptyError);
  });

  it('rejects two providers registered under the same name', () => {
    expect(() => buildRegistry('twilio', [SmsProviderName.TWILIO, SmsProviderName.TWILIO])).toThrow(
      DuplicateProviderError,
    );
  });
});

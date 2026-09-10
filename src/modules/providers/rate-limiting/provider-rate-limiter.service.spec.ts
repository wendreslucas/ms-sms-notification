import { ConfigService } from '@nestjs/config';

import { RateLimitNotConfiguredError } from '../../../common/errors/rate-limit-not-configured-error';
import { ProviderRegistryService } from '../provider-registry.service';
import { RateLimitCounterStore } from './rate-limit-counter-store.interface';
import { ProviderRateLimiterService } from './provider-rate-limiter.service';

describe('ProviderRateLimiterService', () => {
  it('reads provider-specific rate limit configuration', () => {
    const service = buildService();

    expect(service.getLimitConfig('twilio')).toEqual({
      max: 7,
      durationMs: 1500,
    });
    expect(service.getLimitConfig('bird')).toEqual({
      max: 3,
      durationMs: 2500,
    });
  });

  it('reads the limits of any provider from its own configuration block', () => {
    const service = buildService();

    expect(service.getLimitConfig('example')).toEqual({
      max: 5,
      durationMs: 1000,
    });
  });

  it('allows calls within the configured provider window without sleeping', async () => {
    const counterStore = buildCounterStore([{ count: 1, ttlMs: 1000 }]);
    const service = buildService(counterStore);

    await service.throttle('twilio');

    expect(counterStore.increment).toHaveBeenCalledWith(
      expect.stringMatching(/^sms:rate-limit:twilio:/),
      1500,
    );
  });

  it('waits for the window to roll over when the provider limit is exceeded', async () => {
    const counterStore = buildCounterStore([
      { count: 8, ttlMs: 5 },
      { count: 8, ttlMs: 5 },
      { count: 1, ttlMs: 1500 },
    ]);
    const service = buildService(counterStore);

    const startedAt = Date.now();
    await service.throttle('twilio');

    expect(counterStore.increment).toHaveBeenCalledTimes(3);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
  });

  it("applies each provider's own limit rather than a shared one", async () => {
    const counterStore = buildCounterStore([
      { count: 1, ttlMs: 1000 },
      { count: 1, ttlMs: 1000 },
    ]);
    const service = buildService(counterStore);

    await service.throttle('twilio');
    await service.throttle('bird');

    expect(counterStore.increment).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^sms:rate-limit:twilio:/),
      1500,
    );
    expect(counterStore.increment).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^sms:rate-limit:bird:/),
      2500,
    );
  });

  it('rejects a provider without limits instead of silently skipping the limit', () => {
    const service = buildService();

    expect(() => service.getLimitConfig('vonage')).toThrow(RateLimitNotConfiguredError);
  });

  it('rejects limits that are not positive integers', () => {
    const service = buildService();

    expect(() => service.getLimitConfig('broken')).toThrow(RateLimitNotConfiguredError);
  });

  it('starts when every configured provider has limits', () => {
    const service = buildService(buildCounterStore(), ['twilio', 'bird', 'example']);

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('fails at startup when a configured provider has no limits', () => {
    const counterStore = buildCounterStore();
    const service = buildService(counterStore, ['twilio', 'vonage']);

    expect(() => service.onModuleInit()).toThrow(RateLimitNotConfiguredError);
    expect(counterStore.increment).not.toHaveBeenCalled();
  });

  function buildService(
    counterStore = buildCounterStore(),
    configuredProviders = ['twilio', 'bird'],
  ): ProviderRateLimiterService {
    const providerRegistry = {
      getConfiguredProviderNames: () => configuredProviders,
    } as unknown as ProviderRegistryService;

    return new ProviderRateLimiterService(buildConfigService(), counterStore, providerRegistry);
  }

  function buildConfigService(): ConfigService {
    const values = new Map<string, number>([
      ['providers.twilio.rateLimitMax', 7],
      ['providers.twilio.rateLimitDurationMs', 1500],
      ['providers.bird.rateLimitMax', 3],
      ['providers.bird.rateLimitDurationMs', 2500],
      ['providers.example.rateLimitMax', 5],
      ['providers.example.rateLimitDurationMs', 1000],
      ['providers.broken.rateLimitMax', 0],
      ['providers.broken.rateLimitDurationMs', 1000],
    ]);

    return {
      get: (key: string) => values.get(key),
    } as ConfigService;
  }

  function buildCounterStore(
    results = [{ count: 1, ttlMs: 1000 }],
  ): RateLimitCounterStore & { increment: jest.Mock } {
    return {
      increment: jest.fn(async () => results.shift() ?? { count: 1, ttlMs: 1000 }),
    };
  }
});

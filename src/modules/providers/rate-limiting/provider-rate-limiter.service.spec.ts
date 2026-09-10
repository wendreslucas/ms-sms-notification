import { ConfigService } from '@nestjs/config';

import { RateLimitCounterStore } from './rate-limit-counter-store.interface';
import { ProviderRateLimiterService } from './provider-rate-limiter.service';

describe('ProviderRateLimiterService', () => {
  it('reads provider-specific rate limit configuration', () => {
    const service = new ProviderRateLimiterService(buildConfigService(), buildCounterStore());

    expect(service.getLimitConfig('twilio')).toEqual({
      max: 7,
      durationMs: 1500,
    });
    expect(service.getLimitConfig('bird')).toEqual({
      max: 3,
      durationMs: 2500,
    });
  });

  it('allows calls within the configured provider window without sleeping', async () => {
    const counterStore = buildCounterStore([{ count: 1, ttlMs: 1000 }]);
    const service = new ProviderRateLimiterService(buildConfigService(), counterStore);

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
    const service = new ProviderRateLimiterService(buildConfigService(), counterStore);

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
    const service = new ProviderRateLimiterService(buildConfigService(), counterStore);

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

  it('rejects an unknown provider instead of silently skipping the limit', () => {
    const service = new ProviderRateLimiterService(buildConfigService(), buildCounterStore());

    expect(() => service.getLimitConfig('vonage')).toThrow(
      'Unknown SMS provider rate-limit configuration: "vonage".',
    );
  });

  function buildConfigService(): ConfigService {
    const values = new Map<string, number>([
      ['providers.twilio.rateLimitMax', 7],
      ['providers.twilio.rateLimitDurationMs', 1500],
      ['providers.bird.rateLimitMax', 3],
      ['providers.bird.rateLimitDurationMs', 2500],
    ]);

    return {
      getOrThrow: (key: string) => values.get(key),
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

export interface RateLimitCounterResult {
  count: number;
  ttlMs: number;
}

export interface RateLimitCounterStore {
  increment(key: string, durationMs: number): Promise<RateLimitCounterResult>;
}

export const RATE_LIMIT_COUNTER_STORE = 'RATE_LIMIT_COUNTER_STORE';

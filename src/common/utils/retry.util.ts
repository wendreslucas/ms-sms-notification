import { InvalidRetryConfigurationError } from '../errors/invalid-retry-configuration-error';

export function calculateExponentialBackoff(attempt: number, baseDelayMs: number): number {
  if (attempt < 1) {
    throw new InvalidRetryConfigurationError('attempt', attempt);
  }

  if (baseDelayMs < 1) {
    throw new InvalidRetryConfigurationError('baseDelayMs', baseDelayMs);
  }

  return baseDelayMs * 2 ** (attempt - 1);
}

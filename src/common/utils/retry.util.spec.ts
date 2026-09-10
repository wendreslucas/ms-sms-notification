import { InvalidRetryConfigurationError } from '../errors/invalid-retry-configuration-error';
import { calculateExponentialBackoff } from './retry.util';

describe('calculateExponentialBackoff', () => {
  it('calculates exponential backoff from a base delay', () => {
    expect(calculateExponentialBackoff(1, 2000)).toBe(2000);
    expect(calculateExponentialBackoff(2, 2000)).toBe(4000);
    expect(calculateExponentialBackoff(3, 2000)).toBe(8000);
  });

  it('rejects invalid inputs', () => {
    expect(() => calculateExponentialBackoff(0, 2000)).toThrow(InvalidRetryConfigurationError);
    expect(() => calculateExponentialBackoff(1, 0)).toThrow(InvalidRetryConfigurationError);
  });
});

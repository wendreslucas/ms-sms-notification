export function calculateExponentialBackoff(attempt: number, baseDelayMs: number): number {
  if (attempt < 1) {
    throw new Error('attempt must be greater than or equal to 1.');
  }

  if (baseDelayMs < 1) {
    throw new Error('baseDelayMs must be greater than or equal to 1.');
  }

  return baseDelayMs * 2 ** (attempt - 1);
}

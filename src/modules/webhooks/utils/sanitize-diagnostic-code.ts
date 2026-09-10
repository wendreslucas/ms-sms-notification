const MAX_DIAGNOSTIC_CODE_LENGTH = 64;

/**
 * Normalizes a provider-supplied code into a short, log-safe diagnostic token.
 *
 * Only the code is kept; free-form provider text, phone numbers and message
 * bodies must never reach `lastError`.
 */
export function sanitizeDiagnosticCode(value: string): string {
  const sanitized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (sanitized.length === 0) {
    return 'UNKNOWN';
  }

  return sanitized.slice(0, MAX_DIAGNOSTIC_CODE_LENGTH);
}

import { sanitizeDiagnosticCode } from './sanitize-diagnostic-code';

describe('sanitizeDiagnosticCode', () => {
  it('uppercases and normalizes separators', () => {
    expect(sanitizeDiagnosticCode('blocked_by-carrier')).toBe('BLOCKED_BY_CARRIER');
  });

  it('keeps numeric provider codes intact', () => {
    expect(sanitizeDiagnosticCode('30003')).toBe('30003');
  });

  it('collapses punctuation and whitespace into single underscores', () => {
    expect(sanitizeDiagnosticCode('  content rejected!!  ')).toBe('CONTENT_REJECTED');
  });

  it('falls back to UNKNOWN when nothing usable remains', () => {
    expect(sanitizeDiagnosticCode('   ---   ')).toBe('UNKNOWN');
  });

  it('caps the length so lastError stays a short diagnostic', () => {
    expect(sanitizeDiagnosticCode('a'.repeat(200))).toHaveLength(64);
  });
});

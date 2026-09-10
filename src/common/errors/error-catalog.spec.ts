import { HttpStatus } from '@nestjs/common';

import { ERROR_CATALOG, ErrorCode } from './error-catalog';

const KNOWN_AREAS = ['SMS_', 'QUEUE_', 'PROVIDER_', 'RATE_LIMIT_', 'RETRY_', 'WEBHOOK_'];

describe('ERROR_CATALOG', () => {
  const codes = Object.values(ErrorCode);

  it('defines every error code and nothing else', () => {
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual([...codes].sort());
  });

  it.each(codes)('%s uses its own name as its value', (code) => {
    expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code);
  });

  it.each(codes)('%s belongs to a known area', (code) => {
    expect(KNOWN_AREAS.some((area) => code.startsWith(area))).toBe(true);
  });

  it.each(codes)('%s has a complete sentence as its message', (code) => {
    const { message } = ERROR_CATALOG[code];

    expect(message.trim().length).toBeGreaterThan(0);
    expect(message.endsWith('.')).toBe(true);
  });

  it.each(codes)('%s maps to an HTTP error status', (code) => {
    const { httpStatus } = ERROR_CATALOG[code];

    expect(Object.values(HttpStatus)).toContain(httpStatus);
    expect(httpStatus).toBeGreaterThanOrEqual(HttpStatus.BAD_REQUEST);
  });

  it('gives every code its own message, so a message always points at one cause', () => {
    const messages = codes.map((code) => ERROR_CATALOG[code].message);

    expect(new Set(messages).size).toBe(messages.length);
  });
});

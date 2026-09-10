import { buildBirdLastError, extractBirdDeliveryEvent } from './bird-webhook-event';

describe('extractBirdDeliveryEvent', () => {
  it('reads the event type, sms id, timestamp and error code', () => {
    const event = extractBirdDeliveryEvent({
      type: 'sms.undelivered',
      timestamp: '2026-09-09T10:15:30.000Z',
      data: {
        sms_id: 'sms_123',
        workspace_id: 'wrk_1',
        to: '+14155552671',
        from: '+14155550100',
        error: {
          code: 'unreachable',
          description: 'Handset out of coverage',
          carrier_error_code: '21',
          occurred_at: '2026-09-09T10:15:29.000Z',
        },
      },
    });

    expect(event).toEqual({
      type: 'sms.undelivered',
      smsId: 'sms_123',
      occurredAt: new Date('2026-09-09T10:15:30.000Z'),
      errorCode: 'unreachable',
    });
  });

  it('accepts a success event without an error object', () => {
    const event = extractBirdDeliveryEvent({
      type: 'sms.delivered',
      timestamp: '2026-09-09T10:15:30.000Z',
      data: { sms_id: 'sms_123', carrier: 'Carrier', mcc_mnc: '31026' },
    });

    expect(event?.errorCode).toBeNull();
    expect(event?.type).toBe('sms.delivered');
  });

  it('returns a null timestamp when the envelope carries an unusable one', () => {
    const event = extractBirdDeliveryEvent({
      type: 'sms.delivered',
      timestamp: 'not-a-date',
      data: { sms_id: 'sms_123' },
    });

    expect(event?.occurredAt).toBeNull();
  });

  it.each([
    ['a missing type', { timestamp: '2026-09-09T10:15:30.000Z', data: { sms_id: 'sms_123' } }],
    ['a missing data object', { type: 'sms.delivered' }],
    ['a missing sms_id', { type: 'sms.delivered', data: { workspace_id: 'wrk_1' } }],
    ['a non-object payload', 'string-event'],
  ])('returns null for %s', (_label, payload) => {
    expect(extractBirdDeliveryEvent(payload)).toBeNull();
  });
});

describe('buildBirdLastError', () => {
  it('uses the normalized Bird error code', () => {
    expect(
      buildBirdLastError({
        type: 'sms.undelivered',
        smsId: 'sms_123',
        occurredAt: null,
        errorCode: 'unreachable',
      }),
    ).toBe('BIRD_UNREACHABLE');
  });

  it('falls back to the event name when Bird sends no error object', () => {
    expect(
      buildBirdLastError({
        type: 'sms.rejected',
        smsId: 'sms_123',
        occurredAt: null,
        errorCode: null,
      }),
    ).toBe('BIRD_REJECTED');
  });
});

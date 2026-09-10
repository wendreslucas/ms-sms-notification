import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { mapBirdEventType } from './bird-status.mapper';

describe('mapBirdEventType', () => {
  it.each([
    ['sms.sent', SmsStatus.SENT],
    ['sms.delivered', SmsStatus.DELIVERED],
    ['sms.undelivered', SmsStatus.UNDELIVERED],
    ['sms.failed', SmsStatus.FAILED],
    ['sms.rejected', SmsStatus.REJECTED],
  ])('maps %s to %s', (eventType, expected) => {
    expect(mapBirdEventType(eventType)).toBe(expected);
  });

  it('maps sms.expired to UNDELIVERED because delivery failed after acceptance', () => {
    expect(mapBirdEventType('sms.expired')).toBe(SmsStatus.UNDELIVERED);
  });

  it('ignores sms.accepted because it adds nothing after the send was recorded', () => {
    expect(mapBirdEventType('sms.accepted')).toBeNull();
  });

  it.each(['sms.received', 'sms_suppression.created', 'email.delivered', 'sms.some_future_event'])(
    'returns null for %s instead of throwing',
    (eventType) => {
      expect(() => mapBirdEventType(eventType)).not.toThrow();
      expect(mapBirdEventType(eventType)).toBeNull();
    },
  );

  it('never maps an event to FATAL_FAILURE', () => {
    const mappedStatuses = [
      'sms.sent',
      'sms.delivered',
      'sms.undelivered',
      'sms.failed',
      'sms.rejected',
      'sms.expired',
    ].map(mapBirdEventType);

    expect(mappedStatuses).not.toContain(SmsStatus.FATAL_FAILURE);
  });
});

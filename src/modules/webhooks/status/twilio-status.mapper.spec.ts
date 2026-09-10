import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { mapTwilioStatus } from './twilio-status.mapper';

describe('mapTwilioStatus', () => {
  it.each([
    ['delivered', SmsStatus.DELIVERED],
    ['undelivered', SmsStatus.UNDELIVERED],
    ['failed', SmsStatus.FAILED],
    ['sent', SmsStatus.SENT],
    ['canceled', SmsStatus.REJECTED],
  ])('maps %s to %s', (twilioStatus, expected) => {
    expect(mapTwilioStatus(twilioStatus)).toBe(expected);
  });

  it('is case and whitespace insensitive', () => {
    expect(mapTwilioStatus('  DELIVERED ')).toBe(SmsStatus.DELIVERED);
  });

  it.each(['accepted', 'scheduled', 'queued', 'sending', 'read', 'receiving', 'received'])(
    'ignores the intermediate or inbound status %s',
    (twilioStatus) => {
      expect(mapTwilioStatus(twilioStatus)).toBeNull();
    },
  );

  it('returns null for an unknown status instead of throwing', () => {
    expect(() => mapTwilioStatus('some_future_status')).not.toThrow();
    expect(mapTwilioStatus('some_future_status')).toBeNull();
  });

  it('never maps a callback to FATAL_FAILURE', () => {
    const mappedStatuses = ['delivered', 'undelivered', 'failed', 'sent', 'canceled', 'queued'].map(
      mapTwilioStatus,
    );

    expect(mappedStatuses).not.toContain(SmsStatus.FATAL_FAILURE);
  });
});

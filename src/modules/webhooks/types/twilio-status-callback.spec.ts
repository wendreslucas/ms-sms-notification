import { buildTwilioLastError, extractTwilioStatusCallback } from './twilio-status-callback';

describe('extractTwilioStatusCallback', () => {
  it('reads only the fields we need and tolerates unknown Twilio parameters', () => {
    const callback = extractTwilioStatusCallback({
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
      AccountSid: 'AC123',
      From: '+14155550100',
      To: '+14155552671',
      RawDlrDoneDate: '2410021530',
      SomeFutureTwilioParameter: 'value',
    });

    expect(callback).toEqual({
      messageSid: 'SM123',
      messageStatus: 'delivered',
      errorCode: null,
    });
  });

  it('keeps the numeric ErrorCode as a string', () => {
    expect(
      extractTwilioStatusCallback({
        MessageSid: 'SM123',
        MessageStatus: 'undelivered',
        ErrorCode: 30003,
      })?.errorCode,
    ).toBe('30003');
  });

  it('falls back to the SMS-prefixed aliases', () => {
    expect(extractTwilioStatusCallback({ SmsSid: 'SM123', SmsStatus: 'sent' })).toEqual({
      messageSid: 'SM123',
      messageStatus: 'sent',
      errorCode: null,
    });
  });

  it.each([
    ['a missing MessageSid', { MessageStatus: 'delivered' }],
    ['a missing MessageStatus', { MessageSid: 'SM123' }],
    ['an empty MessageSid', { MessageSid: '  ', MessageStatus: 'delivered' }],
  ])('returns null for %s', (_label, payload) => {
    expect(extractTwilioStatusCallback(payload)).toBeNull();
  });

  it.each([undefined, null, 'string-body', ['array-body']])(
    'returns null for a non-object body',
    (payload) => {
      expect(extractTwilioStatusCallback(payload)).toBeNull();
    },
  );
});

describe('buildTwilioLastError', () => {
  it('uses the Twilio error code when present', () => {
    expect(
      buildTwilioLastError({
        messageSid: 'SM123',
        messageStatus: 'undelivered',
        errorCode: '30003',
      }),
    ).toBe('TWILIO_ERROR_30003');
  });

  it('falls back to the external status when Twilio sends no error code', () => {
    expect(
      buildTwilioLastError({ messageSid: 'SM123', messageStatus: 'failed', errorCode: null }),
    ).toBe('TWILIO_STATUS_FAILED');
  });
});

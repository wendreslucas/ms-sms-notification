import { SmsStatus } from '../../sms/entities/sms-status.enum';
import {
  allowedPreviousStatusesFor,
  classifySkippedCallback,
  DELIVERY_TERMINAL_STATUSES,
  isDeliveryFailureStatus,
} from './delivery-status-policy';

describe('allowedPreviousStatusesFor', () => {
  it('only lets SENT be applied before the message reached SENT', () => {
    expect(allowedPreviousStatusesFor(SmsStatus.SENT)).toEqual([
      SmsStatus.QUEUED,
      SmsStatus.PROCESSING,
    ]);
  });

  it('lets DELIVERED upgrade a previously recorded delivery failure', () => {
    const allowed = allowedPreviousStatusesFor(SmsStatus.DELIVERED) ?? [];

    expect(allowed).toEqual(
      expect.arrayContaining([
        SmsStatus.QUEUED,
        SmsStatus.PROCESSING,
        SmsStatus.SENT,
        SmsStatus.UNDELIVERED,
        SmsStatus.REJECTED,
        SmsStatus.FAILED,
      ]),
    );
    expect(allowed).not.toContain(SmsStatus.DELIVERED);
  });

  it.each([SmsStatus.UNDELIVERED, SmsStatus.REJECTED, SmsStatus.FAILED])(
    'never lets %s overwrite DELIVERED or another terminal outcome',
    (status) => {
      expect(allowedPreviousStatusesFor(status)).toEqual([
        SmsStatus.QUEUED,
        SmsStatus.PROCESSING,
        SmsStatus.SENT,
      ]);
    },
  );

  it.each([SmsStatus.QUEUED, SmsStatus.PROCESSING, SmsStatus.FATAL_FAILURE])(
    'refuses to apply %s from a delivery callback',
    (status) => {
      expect(allowedPreviousStatusesFor(status)).toBeNull();
    },
  );

  it('never allows FATAL_FAILURE as a previous status', () => {
    const everyAllowedList = Object.values(SmsStatus).flatMap(
      (status) => allowedPreviousStatusesFor(status) ?? [],
    );

    expect(everyAllowedList).not.toContain(SmsStatus.FATAL_FAILURE);
  });
});

describe('classifySkippedCallback', () => {
  it('reports a repeated status as a duplicate', () => {
    expect(classifySkippedCallback(SmsStatus.DELIVERED, SmsStatus.DELIVERED)).toBe('DUPLICATE');
  });

  it('reports two different terminal outcomes as a conflict', () => {
    expect(classifySkippedCallback(SmsStatus.DELIVERED, SmsStatus.FAILED)).toBe('CONFLICT');
    expect(classifySkippedCallback(SmsStatus.UNDELIVERED, SmsStatus.FAILED)).toBe('CONFLICT');
  });

  it('reports a regression as ignored', () => {
    expect(classifySkippedCallback(SmsStatus.DELIVERED, SmsStatus.SENT)).toBe('IGNORED');
  });

  it('reports a callback on an internal fatal failure as ignored, not a conflict', () => {
    expect(classifySkippedCallback(SmsStatus.FATAL_FAILURE, SmsStatus.DELIVERED)).toBe('IGNORED');
  });
});

describe('isDeliveryFailureStatus', () => {
  it.each([SmsStatus.UNDELIVERED, SmsStatus.REJECTED, SmsStatus.FAILED])(
    'treats %s as a delivery failure',
    (status) => {
      expect(isDeliveryFailureStatus(status)).toBe(true);
    },
  );

  it.each([SmsStatus.DELIVERED, SmsStatus.SENT, SmsStatus.FATAL_FAILURE])(
    'does not treat %s as a delivery failure',
    (status) => {
      expect(isDeliveryFailureStatus(status)).toBe(false);
    },
  );

  it('keeps DELIVERED among the terminal delivery statuses', () => {
    expect(DELIVERY_TERMINAL_STATUSES).toContain(SmsStatus.DELIVERED);
    expect(DELIVERY_TERMINAL_STATUSES).not.toContain(SmsStatus.FATAL_FAILURE);
  });
});

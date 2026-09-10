import { SmsStatus } from '../../sms/entities/sms-status.enum';

/**
 * Twilio Message status values documented for status callbacks.
 *
 * Only the values that carry new delivery information are mapped. `accepted`,
 * `scheduled`, `queued` and `sending` are intermediate states that would regress
 * a message we already marked SENT when the send API accepted it, so they are
 * ignored. `read`, `receiving` and `received` do not apply to outbound SMS.
 *
 * Unknown values return `null` instead of throwing: Twilio may add statuses, and
 * a callback we do not understand must never fail the request.
 */
const TWILIO_STATUS_MAP: Readonly<Record<string, SmsStatus>> = {
  sent: SmsStatus.SENT,
  delivered: SmsStatus.DELIVERED,
  undelivered: SmsStatus.UNDELIVERED,
  failed: SmsStatus.FAILED,
  // A scheduled message cancelled before it was handed to a carrier was refused
  // before delivery processing, which matches our REJECTED semantics.
  canceled: SmsStatus.REJECTED,
};

export function mapTwilioStatus(status: string): SmsStatus | null {
  return TWILIO_STATUS_MAP[status.trim().toLowerCase()] ?? null;
}

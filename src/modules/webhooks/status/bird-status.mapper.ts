import { SmsStatus } from '../../sms/entities/sms-status.enum';

/**
 * Bird `sms.*` webhook event types.
 *
 * `sms.accepted` only repeats that Bird took the send request, which we already
 * recorded as SENT, so it is ignored rather than mapped.
 *
 * `sms.expired` is mapped to UNDELIVERED: the message was accepted and handed on,
 * but its validity period elapsed before the carrier could deliver it. That is a
 * delivery failure after acceptance, not a refusal, which is exactly what
 * UNDELIVERED means here.
 *
 * Unknown event types return `null` so newer Bird events cannot break this
 * handler.
 */
const BIRD_EVENT_STATUS_MAP: Readonly<Record<string, SmsStatus>> = {
  'sms.sent': SmsStatus.SENT,
  'sms.delivered': SmsStatus.DELIVERED,
  'sms.undelivered': SmsStatus.UNDELIVERED,
  'sms.failed': SmsStatus.FAILED,
  'sms.rejected': SmsStatus.REJECTED,
  'sms.expired': SmsStatus.UNDELIVERED,
};

export function mapBirdEventType(eventType: string): SmsStatus | null {
  return BIRD_EVENT_STATUS_MAP[eventType.trim().toLowerCase()] ?? null;
}

import { sanitizeDiagnosticCode } from '../utils/sanitize-diagnostic-code';

export interface BirdDeliveryEvent {
  type: string;
  smsId: string;
  occurredAt: Date | null;
  errorCode: string | null;
}

function readString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reads the fields we need from an already verified Bird webhook event.
 *
 * The envelope is `{ type, timestamp, data }`; `data.sms_id` is the identifier
 * the Bird provider stored as `provider_message_id` when the send was accepted.
 * Failure events carry a `data.error` object whose `code` is the normalized,
 * Bird-defined reason.
 */
export function extractBirdDeliveryEvent(event: unknown): BirdDeliveryEvent | null {
  const record = toRecord(event);

  if (!record) {
    return null;
  }

  const type = readString(record, 'type');
  const data = toRecord(record.data);

  if (!type || !data) {
    return null;
  }

  const smsId = readString(data, 'sms_id');

  if (!smsId) {
    return null;
  }

  const error = toRecord(data.error);

  return {
    type,
    smsId,
    occurredAt: parseTimestamp(readString(record, 'timestamp')),
    errorCode: error ? readString(error, 'code') : null,
  };
}

export function buildBirdLastError(event: BirdDeliveryEvent): string {
  if (event.errorCode) {
    return `BIRD_${sanitizeDiagnosticCode(event.errorCode)}`;
  }

  const eventSuffix = event.type.includes('.')
    ? event.type.split('.').slice(1).join('.')
    : event.type;

  return `BIRD_${sanitizeDiagnosticCode(eventSuffix)}`;
}

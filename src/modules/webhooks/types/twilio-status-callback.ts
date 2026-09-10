import { sanitizeDiagnosticCode } from '../utils/sanitize-diagnostic-code';

export interface TwilioStatusCallback {
  messageSid: string;
  messageStatus: string;
  errorCode: string | null;
}

function readString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/**
 * Extracts only the fields we need from a Twilio status callback.
 *
 * Twilio may add parameters to callbacks at any time, so the payload is read
 * field by field instead of being validated against a closed DTO.
 */
export function extractTwilioStatusCallback(payload: unknown): TwilioStatusCallback | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const messageSid = readString(record, 'MessageSid') ?? readString(record, 'SmsSid');
  const messageStatus = readString(record, 'MessageStatus') ?? readString(record, 'SmsStatus');

  if (!messageSid || !messageStatus) {
    return null;
  }

  return {
    messageSid,
    messageStatus,
    errorCode: readString(record, 'ErrorCode'),
  };
}

export function buildTwilioLastError(callback: TwilioStatusCallback): string {
  if (callback.errorCode) {
    return `TWILIO_ERROR_${sanitizeDiagnosticCode(callback.errorCode)}`;
  }

  return `TWILIO_STATUS_${sanitizeDiagnosticCode(callback.messageStatus)}`;
}

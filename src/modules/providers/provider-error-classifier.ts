import { maskPhoneNumber } from '../../common/utils/mask-phone-number';
import { SmsProviderException } from './sms-provider.exception';
import { SmsProviderName } from './sms-provider-name.enum';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND']);
const BIRD_NON_RETRYABLE_ERROR_NAMES = new Set([
  'BirdAuthError',
  'BirdPermissionError',
  'BirdValidationError',
  'BirdMissingApiKeyError',
]);
const BIRD_RETRYABLE_ERROR_NAMES = new Set([
  'BirdTimeoutError',
  'BirdConnectionError',
  'BirdRateLimitError',
]);

export function normalizeTwilioError(error: unknown): SmsProviderException {
  const httpStatus = getNumericProperty(error, 'status') ?? getNumericProperty(error, 'statusCode');
  const providerCode = getProviderCode(error, 'code');
  const moreInfo = getStringProperty(error, 'moreInfo');

  return new SmsProviderException({
    provider: SmsProviderName.TWILIO,
    providerCode,
    message: sanitizeErrorMessage(error),
    httpStatus,
    retryable: isRetryableTransportError(getRetryableErrorCode(providerCode), httpStatus),
    retryAfterMs: extractRetryAfterMs(error),
    ...(moreInfo ? { providerMetadata: { moreInfo } } : {}),
  });
}

export function normalizeBirdError(error: unknown): SmsProviderException {
  const errorName = getErrorName(error);

  if (errorName && BIRD_RETRYABLE_ERROR_NAMES.has(errorName)) {
    return new SmsProviderException({
      provider: SmsProviderName.BIRD,
      providerCode: getProviderCode(error, 'code'),
      message: sanitizeErrorMessage(error),
      httpStatus: getNumericProperty(error, 'statusCode') ?? getNumericProperty(error, 'status'),
      retryable: true,
      retryAfterMs: extractRetryAfterMs(error),
    });
  }

  if (errorName && BIRD_NON_RETRYABLE_ERROR_NAMES.has(errorName)) {
    return new SmsProviderException({
      provider: SmsProviderName.BIRD,
      providerCode: getProviderCode(error, 'code'),
      message: sanitizeErrorMessage(error),
      httpStatus: getNumericProperty(error, 'statusCode') ?? getNumericProperty(error, 'status'),
      retryable: false,
      retryAfterMs: extractRetryAfterMs(error),
    });
  }

  const httpStatus = getNumericProperty(error, 'statusCode') ?? getNumericProperty(error, 'status');
  const providerCode = getProviderCode(error, 'code');

  return new SmsProviderException({
    provider: SmsProviderName.BIRD,
    providerCode,
    message: sanitizeErrorMessage(error),
    httpStatus,
    retryable: isRetryableTransportError(getRetryableErrorCode(providerCode), httpStatus),
    retryAfterMs: extractRetryAfterMs(error),
  });
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeSensitiveText(error.message);
  }

  return 'Provider request failed.';
}

function isRetryableTransportError(
  code: string | undefined,
  statusCode: number | undefined,
): boolean {
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  return statusCode !== undefined && RETRYABLE_STATUS_CODES.has(statusCode);
}

function getNumericProperty(value: unknown, propertyName: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const propertyValue = value[propertyName];

  return typeof propertyValue === 'number' ? propertyValue : undefined;
}

function getStringProperty(value: unknown, propertyName: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const propertyValue = value[propertyName];

  return typeof propertyValue === 'string' ? propertyValue : undefined;
}

function getProviderCode(value: unknown, propertyName: string): string | number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const propertyValue = value[propertyName];

  return typeof propertyValue === 'string' || typeof propertyValue === 'number'
    ? propertyValue
    : undefined;
}

function getRetryableErrorCode(code: string | number | undefined): string | undefined {
  return typeof code === 'string' ? code : undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  const retryAfterMs = getNumericProperty(error, 'retryAfterMs');

  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs;
  }

  const retryAfter = getNumericProperty(error, 'retryAfter') ?? getRetryAfterHeader(error);

  if (retryAfter !== undefined && retryAfter > 0) {
    return retryAfter * 1000;
  }

  return undefined;
}

function getRetryAfterHeader(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const headers = error.headers;

  if (!isRecord(headers)) {
    return undefined;
  }

  const retryAfterHeader = headers['retry-after'] ?? headers['Retry-After'];

  if (typeof retryAfterHeader === 'number') {
    return retryAfterHeader;
  }

  if (typeof retryAfterHeader === 'string' && retryAfterHeader.trim().length > 0) {
    const parsedValue = Number(retryAfterHeader);

    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error && error.constructor.name) {
    return error.constructor.name;
  }

  return getStringProperty(error, 'name');
}

function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/\+\d{7,15}\b/g, (phone) => maskPhoneNumber(phone))
    .replace(
      /\bAC[0-9a-fA-F]{32}\b/g,
      (accountSid) => `${accountSid.slice(0, 4)}***${accountSid.slice(-4)}`,
    );
}

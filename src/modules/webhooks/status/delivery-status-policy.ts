import { SmsStatus } from '../../sms/entities/sms-status.enum';

/**
 * Statuses that describe the outcome of a delivery receipt. Once a message
 * reaches one of them the delivery lifecycle is over and only a strict upgrade
 * (see {@link allowedPreviousStatusesFor}) may change it again.
 */
export const DELIVERY_TERMINAL_STATUSES: readonly SmsStatus[] = [
  SmsStatus.DELIVERED,
  SmsStatus.UNDELIVERED,
  SmsStatus.REJECTED,
  SmsStatus.FAILED,
];

const DELIVERY_FAILURE_STATUSES: readonly SmsStatus[] = [
  SmsStatus.UNDELIVERED,
  SmsStatus.REJECTED,
  SmsStatus.FAILED,
];

/**
 * Progression policy applied to provider delivery callbacks:
 *
 *   QUEUED < PROCESSING < SENT < terminal delivery status
 *
 * Callbacks are not ordered, so every update is expressed as the set of
 * statuses a message is allowed to be in *before* the update is applied. The
 * update itself runs as a single conditional SQL statement, which makes
 * duplicate and out-of-order callbacks no-ops instead of regressions.
 *
 * DELIVERED is treated as the strongest outcome: it may upgrade a previously
 * recorded failure, but no failure callback may ever overwrite it. FATAL_FAILURE
 * belongs to the internal send flow and is never reachable from a callback.
 */
export function allowedPreviousStatusesFor(status: SmsStatus): SmsStatus[] | null {
  if (status === SmsStatus.SENT) {
    return [SmsStatus.QUEUED, SmsStatus.PROCESSING];
  }

  if (status === SmsStatus.DELIVERED) {
    return [SmsStatus.QUEUED, SmsStatus.PROCESSING, SmsStatus.SENT, ...DELIVERY_FAILURE_STATUSES];
  }

  if (DELIVERY_FAILURE_STATUSES.includes(status)) {
    return [SmsStatus.QUEUED, SmsStatus.PROCESSING, SmsStatus.SENT];
  }

  return null;
}

export type SkippedCallbackReason = 'DUPLICATE' | 'CONFLICT' | 'IGNORED';

/**
 * Explains why a callback did not change the stored status, so the caller can
 * emit the right log event without guessing.
 */
export function classifySkippedCallback(
  currentStatus: SmsStatus,
  incomingStatus: SmsStatus,
): SkippedCallbackReason {
  if (currentStatus === incomingStatus) {
    return 'DUPLICATE';
  }

  if (
    DELIVERY_TERMINAL_STATUSES.includes(currentStatus) &&
    DELIVERY_TERMINAL_STATUSES.includes(incomingStatus)
  ) {
    return 'CONFLICT';
  }

  return 'IGNORED';
}

export function isDeliveryFailureStatus(status: SmsStatus): boolean {
  return DELIVERY_FAILURE_STATUSES.includes(status);
}

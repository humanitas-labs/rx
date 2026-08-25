// Delivery orchestration (plan step 10): pre-send cursor → automation →
// poll for the matching outgoing source record. Automation exit success
// without a source record is failure (spec/v0.md §4.4) — that is exactly
// the silent-drop failure mode spike 3b demonstrated.

import type { BodyDecoder } from '@rx/apple-body-decoder';

import type { MessagesReader } from '@/apple-messages/reader';
import type { AutomationFailure, SendAutomation, SendTarget } from '@/delivery/send';
import { findVerifiedOutbound, sourceCursor, type VerifiedOutbound } from '@/delivery/verify';

export type DeliveryFailure = AutomationFailure | 'not-verified';

export type DeliveryOutcome =
  | { state: 'verified'; verified: VerifiedOutbound }
  | { state: 'failed'; reason: DeliveryFailure };

export interface DeliveryTiming {
  /** Give up waiting for the source record after this long. */
  timeoutMs: number;
  pollMs: number;
}

export const DEFAULT_DELIVERY_TIMING: DeliveryTiming = { timeoutMs: 15_000, pollMs: 250 };

export async function deliver(
  deps: { reader: MessagesReader; decoder: BodyDecoder; automation: SendAutomation },
  target: SendTarget,
  text: string,
  timing: DeliveryTiming = DEFAULT_DELIVERY_TIMING,
): Promise<DeliveryOutcome> {
  const afterRowId = sourceCursor(deps.reader);
  const result = await deps.automation(target, text);
  if (!result.ok) {
    return { state: 'failed', reason: result.reason };
  }
  const deadline = Date.now() + timing.timeoutMs;
  for (;;) {
    const verified = findVerifiedOutbound(deps.reader, deps.decoder, {
      target,
      afterRowId,
      text,
    });
    if (verified !== null) {
      return { state: 'verified', verified };
    }
    if (Date.now() >= deadline) {
      return { state: 'failed', reason: 'not-verified' };
    }
    await new Promise((resolve) => setTimeout(resolve, timing.pollMs));
  }
}

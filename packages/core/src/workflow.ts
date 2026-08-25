// Workflow transition rules from spec/v0.md §3.1–§3.5, kept pure so they are
// testable without Electron or SQLite. Persistence applies these decisions;
// it does not reimplement them.

import type { SourceCursor, WorkflowState } from '@/types';

export interface SourceActivity {
  /** Cursor of the newest inbound message currently known. */
  latestInbound: SourceCursor | null;
  /** True when rx verified an outbound send from this conversation. */
  verifiedOutbound: boolean;
  /** Current time, epoch milliseconds. */
  now: number;
}

/**
 * Decide the current effective state given stored state and source activity.
 * Returns the stored state itself when nothing resurfaces it.
 *
 * Resurfacing rules:
 * - archived: a later inbound message or a verified outbound send returns it
 *   to inbox;
 * - snoozed: wake time reached, a later inbound message, or a verified
 *   outbound send returns it to inbox.
 */
export function reconcile(state: WorkflowState, activity: SourceActivity): WorkflowState {
  if (state.kind === 'inbox') {
    return state;
  }
  const laterInbound =
    activity.latestInbound !== null && activity.latestInbound > state.inboundWatermark;
  if (laterInbound || activity.verifiedOutbound) {
    return { kind: 'inbox' };
  }
  if (state.kind === 'snoozed' && activity.now >= state.wakeAt) {
    return { kind: 'inbox' };
  }
  return state;
}

export function archive(latestInbound: SourceCursor | null): WorkflowState {
  return { kind: 'archived', inboundWatermark: latestInbound ?? 0 };
}

export function snooze(wakeAt: number, latestInbound: SourceCursor | null): WorkflowState {
  return { kind: 'snoozed', wakeAt, inboundWatermark: latestInbound ?? 0 };
}

export function restore(): WorkflowState {
  return { kind: 'inbox' };
}

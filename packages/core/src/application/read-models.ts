// Application read models (plan step 6): join Apple conversation summaries
// with rx workflow state and Space assignment. Pure functions — the desktop
// main process supplies data and maps the result onto the IPC contract.
//
// Rules implemented here, tested here:
// - a conversation with no rx state row is Inbox;
// - a conversation with no Space assignment is Unassigned; `all` aggregates;
// - effective state comes from `reconcile`, so a due snooze or a newer inbound
//   reads as Inbox even before the store persists the wake;
// - rx unread means the latest source inbound is past the rx seen watermark.

import type { MessageRef, SpaceAssignment, WorkflowState } from '../types';
import { reconcile } from '../workflow/rules';
import type { StoredConversation } from '../workflow/store';

export interface SourceConversationSummary {
  chatGuid: string;
  displayName: string | null;
  participantHandles: string[];
  isGroup: boolean;
  lastActivityAtMs: number;
  lastInbound: MessageRef | null;
  sourceUnreadCount: number;
}

/** Workflow state as views consume it: no watermark internals. */
export type ViewWorkflowState =
  { kind: 'inbox' } | { kind: 'archived' } | { kind: 'snoozed'; wakeAt: number };

export interface ConversationView {
  chatGuid: string;
  displayName: string | null;
  participantHandles: string[];
  isGroup: boolean;
  lastActivityAtMs: number;
  unread: boolean;
  sourceUnreadCount: number;
  state: ViewWorkflowState;
  spaceId: number | null;
}

export type ListView = 'inbox' | 'snoozed' | 'archived';
export type SpaceScope = 'all' | 'unassigned' | number;

export function composeConversationViews(
  source: SourceConversationSummary[],
  stored: StoredConversation[],
  assignments: SpaceAssignment[],
  now: number,
): ConversationView[] {
  const storedByChat = new Map(stored.map((row) => [row.chatGuid, row]));
  const spaceByChat = new Map(assignments.map((row) => [row.chatGuid, row.spaceId]));

  return source.map((summary) => {
    const row = storedByChat.get(summary.chatGuid);
    const effective = reconcile(row?.state ?? { kind: 'inbox' }, {
      latestInbound: summary.lastInbound?.rowId ?? null,
      verifiedOutbound: false,
      now,
    });
    return {
      chatGuid: summary.chatGuid,
      displayName: summary.displayName,
      participantHandles: summary.participantHandles,
      isGroup: summary.isGroup,
      lastActivityAtMs: summary.lastActivityAtMs,
      unread:
        summary.lastInbound !== null && summary.lastInbound.rowId > (row?.seenThrough?.rowId ?? -1),
      sourceUnreadCount: summary.sourceUnreadCount,
      state: toViewState(effective),
      spaceId: spaceByChat.get(summary.chatGuid) ?? null,
    };
  });
}

/**
 * Scope and order one list view. Inbox and Archive order by activity,
 * newest first; Snoozed orders by wake time, soonest first.
 */
export function selectConversations(
  views: ConversationView[],
  view: ListView,
  space: SpaceScope,
): ConversationView[] {
  const scoped = views.filter((row) => {
    if (row.state.kind !== view) {
      return false;
    }
    if (space === 'all') {
      return true;
    }
    if (space === 'unassigned') {
      return row.spaceId === null;
    }
    return row.spaceId === space;
  });

  return scoped.sort((a, b) => {
    if (
      a.state.kind === 'snoozed' &&
      b.state.kind === 'snoozed' &&
      a.state.wakeAt !== b.state.wakeAt
    ) {
      return a.state.wakeAt - b.state.wakeAt;
    }
    return b.lastActivityAtMs - a.lastActivityAtMs;
  });
}

function toViewState(state: WorkflowState): ViewWorkflowState {
  switch (state.kind) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'archived':
      return { kind: 'archived' };
    case 'snoozed':
      return { kind: 'snoozed', wakeAt: state.wakeAt };
  }
}

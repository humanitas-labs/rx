// rx domain identity and state types (ADR-002 §3, spec/v0.md §3, §5).
//
// Apple source identity is the chat GUID and message GUID. SQLite row IDs are
// local incremental cursors, never durable identity.

export type ChatGuid = string;
export type MessageGuid = string;

/** Monotonic local cursor into the Apple source (message ROWID). */
export type SourceCursor = number;

export type WorkflowStateKind = 'inbox' | 'archived' | 'snoozed';

/**
 * The rx workflow state attached to one conversation. Exactly one per
 * conversation; it never alters the conversation in Messages.app.
 */
export type WorkflowState =
  | { kind: 'inbox' }
  | {
      kind: 'archived';
      /** Latest inbound message known when the user archived. */
      inboundWatermark: SourceCursor;
    }
  | {
      kind: 'snoozed';
      /** Epoch milliseconds at which the conversation wakes. */
      wakeAt: number;
      /** Latest inbound message known when the snooze was created. */
      inboundWatermark: SourceCursor;
    };

export interface Space {
  id: number;
  name: string;
  position: number;
}

/**
 * A conversation's Space assignment. Single-primary: absence means Unassigned
 * (spec/v0.md §3.6).
 */
export interface SpaceAssignment {
  chatGuid: ChatGuid;
  spaceId: number;
}

export type DeliveryStatus = 'pending' | 'verified' | 'failed';

/**
 * One outbound send awaiting verification against the Apple source record.
 * Automation exit status alone never verifies a send (spec/v0.md §4.4).
 */
export interface DeliveryAttempt {
  chatGuid: ChatGuid;
  requestedAt: number;
  /** Source cursor captured before the send; verification scans after it. */
  preSendCursor: SourceCursor;
  status: DeliveryStatus;
}

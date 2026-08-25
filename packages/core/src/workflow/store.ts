// Persistent rx workflow store (plan step 5). Wraps the separate rx SQLite
// database and applies the pure transition rules from `rules.ts`; it decides
// nothing those rules don't. Every transition is one transaction and returns
// a typed outcome. This store never touches the Apple Messages database.

import { DatabaseSync } from 'node:sqlite';

import type {
  ChatGuid,
  MessageRef,
  Space,
  SpaceAssignment,
  WorkflowState,
} from '@/types';
import { WORKFLOW_MIGRATIONS } from '@/workflow/migrations';
import { reconcile } from '@/workflow/rules';

export interface StoredConversation {
  chatGuid: ChatGuid;
  state: WorkflowState;
  seenThrough: MessageRef | null;
  updatedAt: number;
}

export type SpaceError = 'space-not-found' | 'duplicate-space-name';
export type SpaceOutcome<T> = { ok: T } | { err: SpaceError };

/** Whether a source event moved the conversation back to Inbox. */
export interface ResurfaceOutcome {
  resurfaced: boolean;
}

export interface WorkflowStore {
  archive(chat: ChatGuid, latestInbound: MessageRef | null, now: number): void;
  snooze(chat: ChatGuid, latestInbound: MessageRef | null, wakeAt: number, now: number): void;
  restore(chat: ChatGuid, now: number): void;
  markSeen(chat: ChatGuid, latest: MessageRef, now: number): void;
  receiveInbound(chat: ChatGuid, message: MessageRef, now: number): ResurfaceOutcome;
  verifyOutbound(chat: ChatGuid, message: MessageRef, now: number): ResurfaceOutcome;
  /** Move every snooze whose wake time has passed to Inbox; returns the woken chats. */
  wakeDue(now: number): ChatGuid[];
  getConversation(chat: ChatGuid): StoredConversation | null;
  listConversations(): StoredConversation[];

  createSpace(name: string, now: number): SpaceOutcome<Space>;
  renameSpace(id: number, name: string, now: number): SpaceOutcome<Space>;
  reorderSpace(id: number, position: number, now: number): SpaceOutcome<Space[]>;
  /** Deleting a Space returns its conversations to Unassigned, never touching workflow state. */
  deleteSpace(id: number): SpaceOutcome<null>;
  assignSpace(chat: ChatGuid, spaceId: number | null): SpaceOutcome<null>;
  listSpaces(): Space[];
  listAssignments(): SpaceAssignment[];

  close(): void;
}

export function openWorkflowStore(path: string): WorkflowStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  function tx<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function readRow(chat: ChatGuid): StateRow | undefined {
    return db.prepare('SELECT * FROM conversation_state WHERE chat_guid = ?').get(chat) as
      | StateRow
      | undefined;
  }

  function writeState(
    chat: ChatGuid,
    state: WorkflowState,
    now: number,
    watermarkGuid: string | null = null,
  ): void {
    const archived = state.kind === 'archived' ? state : null;
    const snoozed = state.kind === 'snoozed' ? state : null;
    db.prepare(
      `INSERT INTO conversation_state (
         chat_guid, state,
         archived_through_guid, archived_through_rowid,
         snoozed_through_guid, snoozed_through_rowid, snoozed_until,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_guid) DO UPDATE SET
         state = excluded.state,
         archived_through_guid = excluded.archived_through_guid,
         archived_through_rowid = excluded.archived_through_rowid,
         snoozed_through_guid = excluded.snoozed_through_guid,
         snoozed_through_rowid = excluded.snoozed_through_rowid,
         snoozed_until = excluded.snoozed_until,
         updated_at = excluded.updated_at`,
    ).run(
      chat,
      state.kind,
      archived === null ? null : watermarkGuid,
      archived === null ? null : archived.inboundWatermark,
      snoozed === null ? null : watermarkGuid,
      snoozed === null ? null : snoozed.inboundWatermark,
      snoozed === null ? null : snoozed.wakeAt,
      now,
    );
  }

  function applySourceEvent(
    chat: ChatGuid,
    activity: { latestInbound: number | null; verifiedOutbound: boolean; now: number },
  ): ResurfaceOutcome {
    return tx(() => {
      const row = readRow(chat);
      if (row === undefined) {
        return { resurfaced: false };
      }
      const stored = rowToState(row);
      const next = reconcile(stored, activity);
      if (next.kind === 'inbox' && stored.kind !== 'inbox') {
        writeState(chat, next, activity.now);
        return { resurfaced: true };
      }
      return { resurfaced: false };
    });
  }

  const spacesApi = createSpacesApi(db, tx);

  return {
    archive(chat, latestInbound, now) {
      tx(() => {
        writeState(
          chat,
          { kind: 'archived', inboundWatermark: latestInbound?.rowId ?? 0 },
          now,
          latestInbound?.guid ?? null,
        );
      });
    },

    snooze(chat, latestInbound, wakeAt, now) {
      tx(() => {
        writeState(
          chat,
          { kind: 'snoozed', wakeAt, inboundWatermark: latestInbound?.rowId ?? 0 },
          now,
          latestInbound?.guid ?? null,
        );
      });
    },

    restore(chat, now) {
      tx(() => {
        writeState(chat, { kind: 'inbox' }, now);
      });
    },

    markSeen(chat, latest, now) {
      tx(() => {
        db.prepare(
          `INSERT INTO conversation_state
             (chat_guid, state, seen_through_guid, seen_through_rowid, updated_at)
           VALUES (?, 'inbox', ?, ?, ?)
           ON CONFLICT(chat_guid) DO UPDATE SET
             seen_through_guid = excluded.seen_through_guid,
             seen_through_rowid = excluded.seen_through_rowid,
             updated_at = excluded.updated_at
           WHERE excluded.seen_through_rowid > COALESCE(conversation_state.seen_through_rowid, -1)`,
        ).run(chat, latest.guid, latest.rowId, now);
      });
    },

    receiveInbound(chat, message, now) {
      return applySourceEvent(chat, {
        latestInbound: message.rowId,
        verifiedOutbound: false,
        now,
      });
    },

    verifyOutbound(chat, _message, now) {
      return applySourceEvent(chat, { latestInbound: null, verifiedOutbound: true, now });
    },

    wakeDue(now) {
      return tx(() => {
        const due = db
          .prepare(
            `SELECT chat_guid FROM conversation_state
             WHERE state = 'snoozed' AND snoozed_until <= ?
             ORDER BY snoozed_until`,
          )
          .all(now) as { chat_guid: string }[];
        for (const { chat_guid } of due) {
          writeState(chat_guid, { kind: 'inbox' }, now);
        }
        return due.map((row) => row.chat_guid);
      });
    },

    getConversation(chat) {
      const row = readRow(chat);
      return row === undefined ? null : rowToStored(row);
    },

    listConversations() {
      const rows = db
        .prepare('SELECT * FROM conversation_state ORDER BY chat_guid')
        .all() as unknown as StateRow[];
      return rows.map(rowToStored);
    },

    ...spacesApi,

    close() {
      db.close();
    },
  };
}

interface StateRow {
  chat_guid: string;
  state: 'inbox' | 'archived' | 'snoozed';
  archived_through_guid: string | null;
  archived_through_rowid: number | null;
  snoozed_through_guid: string | null;
  snoozed_through_rowid: number | null;
  snoozed_until: number | null;
  seen_through_guid: string | null;
  seen_through_rowid: number | null;
  updated_at: number;
}

function rowToState(row: StateRow): WorkflowState {
  switch (row.state) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'archived':
      return { kind: 'archived', inboundWatermark: row.archived_through_rowid ?? 0 };
    case 'snoozed':
      return {
        kind: 'snoozed',
        wakeAt: row.snoozed_until ?? 0,
        inboundWatermark: row.snoozed_through_rowid ?? 0,
      };
  }
}

function rowToStored(row: StateRow): StoredConversation {
  return {
    chatGuid: row.chat_guid,
    state: rowToState(row),
    seenThrough:
      row.seen_through_guid === null || row.seen_through_rowid === null
        ? null
        : { guid: row.seen_through_guid, rowId: row.seen_through_rowid },
    updatedAt: row.updated_at,
  };
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = row.user_version; i < WORKFLOW_MIGRATIONS.length; i += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(WORKFLOW_MIGRATIONS[i] ?? '');
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

interface SpaceRow {
  id: number;
  name: string;
  position: number;
}

function createSpacesApi(db: DatabaseSync, tx: <T>(work: () => T) => T) {
  function list(): Space[] {
    return db
      .prepare('SELECT id, name, position FROM spaces ORDER BY position')
      .all() as unknown as SpaceRow[];
  }

  function nameTaken(name: string, exceptId?: number): boolean {
    const row = db.prepare('SELECT id FROM spaces WHERE name = ?').get(name) as
      | { id: number }
      | undefined;
    return row !== undefined && row.id !== exceptId;
  }

  function byId(id: number): SpaceRow | undefined {
    return db.prepare('SELECT id, name, position FROM spaces WHERE id = ?').get(id) as
      | SpaceRow
      | undefined;
  }

  return {
    createSpace(name: string, now: number): SpaceOutcome<Space> {
      return tx(() => {
        if (nameTaken(name)) {
          return { err: 'duplicate-space-name' as const };
        }
        const next = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM spaces').get() as {
          p: number;
        };
        const result = db
          .prepare(
            'INSERT INTO spaces (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)',
          )
          .run(name, next.p, now, now);
        return { ok: { id: Number(result.lastInsertRowid), name, position: next.p } };
      });
    },

    renameSpace(id: number, name: string, now: number): SpaceOutcome<Space> {
      return tx(() => {
        const space = byId(id);
        if (space === undefined) {
          return { err: 'space-not-found' as const };
        }
        if (nameTaken(name, id)) {
          return { err: 'duplicate-space-name' as const };
        }
        db.prepare('UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
        return { ok: { ...space, name } };
      });
    },

    reorderSpace(id: number, position: number, now: number): SpaceOutcome<Space[]> {
      return tx(() => {
        const ordered = list();
        const from = ordered.findIndex((space) => space.id === id);
        if (from === -1) {
          return { err: 'space-not-found' as const };
        }
        const target = Math.max(0, Math.min(position, ordered.length - 1));
        const [moved] = ordered.splice(from, 1);
        ordered.splice(target, 0, moved as Space);
        ordered.forEach((space, index) => {
          if (space.position !== index) {
            db.prepare('UPDATE spaces SET position = ?, updated_at = ? WHERE id = ?').run(
              index,
              now,
              space.id,
            );
          }
        });
        return { ok: list() };
      });
    },

    deleteSpace(id: number): SpaceOutcome<null> {
      return tx(() => {
        const result = db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
        return result.changes === 0 ? { err: 'space-not-found' as const } : { ok: null };
      });
    },

    assignSpace(chat: ChatGuid, spaceId: number | null): SpaceOutcome<null> {
      return tx(() => {
        if (spaceId === null) {
          db.prepare('DELETE FROM conversation_space WHERE chat_guid = ?').run(chat);
          return { ok: null };
        }
        if (byId(spaceId) === undefined) {
          return { err: 'space-not-found' as const };
        }
        db.prepare(
          `INSERT INTO conversation_space (chat_guid, space_id) VALUES (?, ?)
           ON CONFLICT(chat_guid) DO UPDATE SET space_id = excluded.space_id`,
        ).run(chat, spaceId);
        return { ok: null };
      });
    },

    listSpaces: list,

    listAssignments(): SpaceAssignment[] {
      const rows = db
        .prepare('SELECT chat_guid, space_id FROM conversation_space ORDER BY chat_guid')
        .all() as { chat_guid: string; space_id: number }[];
      return rows.map((row) => ({ chatGuid: row.chat_guid, spaceId: row.space_id }));
    },
  };
}

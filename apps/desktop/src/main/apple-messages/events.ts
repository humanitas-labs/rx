// Source-change observation (plan step 4 `events`), following the proven
// spike 2 mechanism: watch the WAL file for cheap wake-ups, keep a bounded
// interval poll as the fallback, and advance a durable MAX(ROWID) cursor
// with a bounded catch-up query. Events carry identity only, never content.

import { watch, type FSWatcher } from 'node:fs';

import type { MessagesReader } from '@/apple-messages/reader';

export interface AffectedChat {
  chatGuid: string;
  latestRowId: number;
  hasInbound: boolean;
}

export interface SourceChangeEvent {
  kind: 'messages-added';
  cursor: number;
  chats: AffectedChat[];
}

export interface SourceObserver {
  start(): void;
  stop(): void;
  /** Run one catch-up pass now; returns the event if anything advanced. */
  check(): SourceChangeEvent | null;
  readonly cursor: number;
}

const CATCH_UP_LIMIT = 500;

export function createSourceObserver(options: {
  reader: MessagesReader;
  dbPath: string;
  onEvent: (event: SourceChangeEvent) => void;
  /** Poll fallback interval; WAL activity triggers earlier checks. */
  pollIntervalMs?: number;
  /** Starting cursor; defaults to the current MAX(ROWID) (only new rows). */
  initialCursor?: number;
}): SourceObserver {
  const { reader, dbPath, onEvent } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;

  let cursor =
    options.initialCursor ??
    Number(reader.get('SELECT COALESCE(MAX(ROWID), 0) AS max_row FROM message')?.['max_row'] ?? 0);

  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function check(): SourceChangeEvent | null {
    const rows = reader.all(
      `SELECT m.ROWID AS row_id,
              m.is_from_me AS is_from_me,
              c.guid AS chat_guid
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       JOIN chat c ON c.ROWID = cmj.chat_id
       WHERE m.ROWID > ?
       ORDER BY m.ROWID
       LIMIT ${CATCH_UP_LIMIT}`,
      cursor,
    );
    if (rows.length === 0) {
      return null;
    }
    const byChat = new Map<string, AffectedChat>();
    for (const row of rows) {
      const chatGuid = String(row['chat_guid']);
      const rowId = Number(row['row_id']);
      const inbound = Number(row['is_from_me']) === 0;
      const existing = byChat.get(chatGuid);
      if (existing) {
        existing.latestRowId = Math.max(existing.latestRowId, rowId);
        existing.hasInbound = existing.hasInbound || inbound;
      } else {
        byChat.set(chatGuid, { chatGuid, latestRowId: rowId, hasInbound: inbound });
      }
      cursor = Math.max(cursor, rowId);
    }
    const event: SourceChangeEvent = {
      kind: 'messages-added',
      cursor,
      chats: [...byChat.values()],
    };
    onEvent(event);
    return event;
  }

  function scheduleCheck() {
    if (debounce) {
      return;
    }
    // WAL writes arrive in bursts; a short debounce batches them into one
    // catch-up pass without adding user-visible latency (spike 2: ~250 ms).
    debounce = setTimeout(() => {
      debounce = null;
      check();
    }, 200);
  }

  return {
    start() {
      if (timer) {
        return;
      }
      try {
        watcher = watch(`${dbPath}-wal`, scheduleCheck);
      } catch {
        watcher = null; // No WAL file yet; the interval poll covers it.
      }
      timer = setInterval(check, pollIntervalMs);
    },
    stop() {
      watcher?.close();
      watcher = null;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
      }
    },
    check,
    get cursor() {
      return cursor;
    },
  };
}

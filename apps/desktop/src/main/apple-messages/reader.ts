// Read-only access to the Apple Messages database (plan step 4 `database`).
//
// The DatabaseSync handle is opened read-only and never leaves this module;
// callers get a query-only reader. Apple date columns are nanoseconds since
// 2001-01-01 and exceed Number.MAX_SAFE_INTEGER, so every query converts
// them to epoch milliseconds in SQL (`date / 1000000 + 978307200000`) rather
// than reading the raw value into a JavaScript number.

import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

export interface MessagesReader {
  all(sql: string, ...params: SqlValue[]): SqlRow[];
  get(sql: string, ...params: SqlValue[]): SqlRow | undefined;
  close(): void;
}

/** SQL expression converting an Apple nanosecond timestamp column to epoch ms. */
export function appleMs(column: string): string {
  return `(${column} / 1000000 + 978307200000)`;
}

export function openMessagesDatabase(path: string): MessagesReader {
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    all(sql, ...params) {
      return db.prepare(sql).all(...params) as SqlRow[];
    },
    get(sql, ...params) {
      return db.prepare(sql).get(...params) as SqlRow | undefined;
    },
    close() {
      db.close();
    },
  };
}

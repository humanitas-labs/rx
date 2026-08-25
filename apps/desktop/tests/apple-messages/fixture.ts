// Synthetic Apple Messages database fixture. Reproduces the chat.db schema
// subset rx reads, with entirely invented conversations — no personal
// messages, handles, or identifiers (spec/v0.md §6.3).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const APPLE_EPOCH_MS = 978_307_200_000;

export function msToAppleNs(ms: number): bigint {
  return BigInt(ms - APPLE_EPOCH_MS) * 1_000_000n;
}

export const FIXTURE_BODY_TEXT = 'Hello rx fixture with a link https://example.com';

export function fixtureAttributedBody(): Uint8Array {
  return readFileSync(
    fileURLToPath(new URL('../fixtures/attributed-body-hello.bin', import.meta.url)),
  );
}

export interface FixtureMessage {
  rowId: number;
  guid: string;
  chatRowId: number;
  text?: string;
  attributedBody?: Uint8Array;
  atMs: number;
  fromMe?: boolean;
  read?: boolean;
  handleRowId?: number;
  itemType?: number;
  groupTitle?: string;
  associatedGuid?: string;
  associatedType?: number;
  balloonBundleId?: string;
  editedAtMs?: number;
  hasAttachments?: boolean;
}

export class MessagesFixture {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(dir: string, options: { omitTables?: string[] } = {}) {
    this.path = join(dir, 'chat.db');
    this.db = new DatabaseSync(this.path);
    const omit = new Set(options.omitTables ?? []);
    const tables: Record<string, string> = {
      chat: `CREATE TABLE chat (
               ROWID INTEGER PRIMARY KEY, guid TEXT NOT NULL UNIQUE,
               display_name TEXT, style INTEGER NOT NULL DEFAULT 45)`,
      handle: `CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT NOT NULL)`,
      chat_handle_join: `CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER)`,
      message: `CREATE TABLE message (
                  ROWID INTEGER PRIMARY KEY, guid TEXT NOT NULL UNIQUE,
                  text TEXT, attributedBody BLOB, date INTEGER NOT NULL,
                  is_from_me INTEGER NOT NULL DEFAULT 0,
                  is_read INTEGER NOT NULL DEFAULT 0,
                  error INTEGER NOT NULL DEFAULT 0,
                  item_type INTEGER NOT NULL DEFAULT 0,
                  group_title TEXT,
                  associated_message_guid TEXT,
                  associated_message_type INTEGER NOT NULL DEFAULT 0,
                  balloon_bundle_id TEXT,
                  date_edited INTEGER NOT NULL DEFAULT 0,
                  cache_has_attachments INTEGER NOT NULL DEFAULT 0,
                  handle_id INTEGER NOT NULL DEFAULT 0)`,
      chat_message_join: `CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER)`,
      attachment: `CREATE TABLE attachment (
                     ROWID INTEGER PRIMARY KEY, guid TEXT NOT NULL,
                     filename TEXT, transfer_name TEXT, mime_type TEXT,
                     total_bytes INTEGER NOT NULL DEFAULT 0)`,
      message_attachment_join: `CREATE TABLE message_attachment_join (
                                  message_id INTEGER, attachment_id INTEGER)`,
    };
    for (const [name, ddl] of Object.entries(tables)) {
      if (!omit.has(name)) {
        this.db.exec(ddl);
      }
    }
  }

  addChat(rowId: number, guid: string, options: { displayName?: string; group?: boolean } = {}) {
    this.db
      .prepare('INSERT INTO chat (ROWID, guid, display_name, style) VALUES (?, ?, ?, ?)')
      .run(rowId, guid, options.displayName ?? null, options.group ? 43 : 45);
  }

  addHandle(rowId: number, id: string) {
    this.db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(rowId, id);
  }

  joinHandle(chatRowId: number, handleRowId: number) {
    this.db
      .prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)')
      .run(chatRowId, handleRowId);
  }

  addMessage(m: FixtureMessage) {
    this.db
      .prepare(
        `INSERT INTO message (ROWID, guid, text, attributedBody, date, is_from_me, is_read,
           item_type, group_title, associated_message_guid, associated_message_type,
           balloon_bundle_id, date_edited, cache_has_attachments, handle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.rowId,
        m.guid,
        m.text ?? null,
        m.attributedBody ?? null,
        msToAppleNs(m.atMs),
        m.fromMe ? 1 : 0,
        (m.read ?? m.fromMe) ? 1 : 0,
        m.itemType ?? 0,
        m.groupTitle ?? null,
        m.associatedGuid ?? null,
        m.associatedType ?? 0,
        m.balloonBundleId ?? null,
        m.editedAtMs ? msToAppleNs(m.editedAtMs) : 0,
        m.hasAttachments ? 1 : 0,
        m.handleRowId ?? 0,
      );
    this.db
      .prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)')
      .run(m.chatRowId, m.rowId);
  }

  addAttachment(
    rowId: number,
    messageRowId: number,
    meta: { guid: string; filename?: string; transferName?: string; mimeType?: string; bytes?: number },
  ) {
    this.db
      .prepare(
        `INSERT INTO attachment (ROWID, guid, filename, transfer_name, mime_type, total_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rowId,
        meta.guid,
        meta.filename ?? null,
        meta.transferName ?? null,
        meta.mimeType ?? null,
        meta.bytes ?? 0,
      );
    this.db
      .prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)')
      .run(messageRowId, rowId);
  }

  close() {
    this.db.close();
  }
}

/** The standard two-conversation fixture used across the module tests. */
export function buildStandardFixture(dir: string): MessagesFixture {
  const f = new MessagesFixture(dir);
  const T0 = 1_756_000_000_000;

  f.addChat(1, 'iMessage;-;fixture-direct');
  f.addChat(2, 'chat000fixture-group', { displayName: 'Fixture Group', group: true });
  f.addHandle(1, '+15550000001');
  f.addHandle(2, 'fixture@example.com');
  f.joinHandle(1, 1);
  f.joinHandle(2, 1);
  f.joinHandle(2, 2);

  // Direct chat: plain text in, text out, attributedBody in (unread).
  f.addMessage({ rowId: 1, guid: 'G-1', chatRowId: 1, text: 'plain inbound', atMs: T0, handleRowId: 1, read: true });
  f.addMessage({ rowId: 2, guid: 'G-2', chatRowId: 1, text: 'outbound reply', atMs: T0 + 1_000, fromMe: true });
  f.addMessage({ rowId: 3, guid: 'G-3', chatRowId: 1, attributedBody: fixtureAttributedBody(), atMs: T0 + 2_000, handleRowId: 1 });

  // Group chat: name change, tapback, balloon app, edited text, attachment.
  f.addMessage({ rowId: 4, guid: 'G-4', chatRowId: 2, itemType: 2, groupTitle: 'Fixture Group', atMs: T0 + 3_000, handleRowId: 2, read: true });
  f.addMessage({ rowId: 5, guid: 'G-5', chatRowId: 2, associatedGuid: 'p:0/G-2', associatedType: 2000, atMs: T0 + 4_000, handleRowId: 1, read: true });
  f.addMessage({ rowId: 6, guid: 'G-6', chatRowId: 2, balloonBundleId: 'com.example.fixture-balloon', atMs: T0 + 5_000, handleRowId: 2, read: true });
  f.addMessage({ rowId: 7, guid: 'G-7', chatRowId: 2, text: 'edited outbound', atMs: T0 + 6_000, fromMe: true, editedAtMs: T0 + 7_000 });
  f.addMessage({ rowId: 8, guid: 'G-8', chatRowId: 2, text: 'photo incoming', atMs: T0 + 8_000, handleRowId: 1, hasAttachments: true });
  f.addAttachment(1, 8, {
    guid: 'A-1',
    filename: '~/Library/Messages/Attachments/ab/cd/fixture-photo.heic',
    transferName: 'fixture-photo.heic',
    mimeType: 'image/heic',
    bytes: 12_345,
  });

  return f;
}

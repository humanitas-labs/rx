// Capability reporting (plan step 4 `capabilities`): missing permissions,
// schema drift, and Messages.app availability, reported as data instead of
// crashes. Nothing here logs message content.

import { accessSync, constants, existsSync } from 'node:fs';

import { openMessagesDatabase, type MessagesReader } from '@/apple-messages/reader';

export type DatabaseAccess = 'ok' | 'not-found' | 'permission-denied' | 'unreadable';

export interface SourceCapabilities {
  database: DatabaseAccess;
  /** Tables required by rx that are missing — non-empty means schema drift. */
  missingTables: string[];
  messagesAppPresent: boolean;
}

const REQUIRED_TABLES = [
  'chat',
  'message',
  'handle',
  'chat_message_join',
  'chat_handle_join',
  'attachment',
  'message_attachment_join',
];

export function checkDatabaseAccess(path: string): DatabaseAccess {
  if (!existsSync(path)) {
    return 'not-found';
  }
  try {
    accessSync(path, constants.R_OK);
  } catch {
    return 'permission-denied';
  }
  try {
    openMessagesDatabase(path).close();
    return 'ok';
  } catch {
    // Full Disk Access denials surface as SQLITE_CANTOPEN on macOS even when
    // stat succeeds.
    return 'permission-denied';
  }
}

export function findMissingTables(reader: MessagesReader): string[] {
  const present = new Set(
    reader
      .all(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => String(row['name'])),
  );
  return REQUIRED_TABLES.filter((table) => !present.has(table));
}

export function checkCapabilities(dbPath: string): SourceCapabilities {
  const database = checkDatabaseAccess(dbPath);
  let missingTables: string[] = [];
  if (database === 'ok') {
    const reader = openMessagesDatabase(dbPath);
    try {
      missingTables = findMissingTables(reader);
    } finally {
      reader.close();
    }
  }
  return {
    database,
    missingTables,
    messagesAppPresent: existsSync('/System/Applications/Messages.app'),
  };
}

// rx workflow schema (plan step 5). Applied in order by the store's migrator;
// `PRAGMA user_version` records how many entries have run. Never edit a shipped
// migration — append a new one.
//
// Watermarks store both the message GUID (durable source identity) and the
// message ROWID (local incremental cursor). Ordering comparisons use the
// ROWID; the GUID lets us re-anchor if the source database is ever rebuilt.
//
// This database never contains message bodies, attachment contents,
// participant names, or conversation summaries.

export const WORKFLOW_MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE conversation_state (
      chat_guid                TEXT PRIMARY KEY,
      state                    TEXT NOT NULL CHECK (state IN ('inbox', 'archived', 'snoozed')),
      archived_through_guid    TEXT,
      archived_through_rowid   INTEGER,
      snoozed_through_guid     TEXT,
      snoozed_through_rowid    INTEGER,
      snoozed_until            INTEGER,
      seen_through_guid        TEXT,
      seen_through_rowid       INTEGER,
      updated_at               INTEGER NOT NULL,
      CHECK (
          (state = 'snoozed' AND snoozed_until IS NOT NULL)
          OR (state != 'snoozed' AND snoozed_until IS NULL)
      )
  ) STRICT;

  CREATE INDEX conversation_state_wake
  ON conversation_state(state, snoozed_until);

  CREATE TABLE spaces (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      position    INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE conversation_space (
      chat_guid   TEXT PRIMARY KEY,
      space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE
  ) STRICT;
  `,
];

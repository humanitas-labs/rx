// Conversation search (plan step 6 read model): match group names,
// participant handles, and plain message text. Attributed-body-only messages
// are not searched yet — decoded-body indexing is a step 8 concern
// (docs/spec/v0.md §4.2). Bounded results; the query never logs.

import type { MessagesReader } from '@/apple-messages/reader';

/** Chat GUIDs matching the query, most recently active first. */
export function searchChatGuids(reader: MessagesReader, query: string, limit: number): string[] {
  const pattern = `%${escapeLike(query)}%`;
  const rows = reader.all(
    `SELECT c.guid AS chat_guid, MAX(m.ROWID) AS last_row_id
     FROM chat c
     JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
     JOIN message m ON m.ROWID = cmj.message_id
     WHERE c.ROWID IN (
         SELECT ROWID FROM chat WHERE display_name LIKE ? ESCAPE '\\'
         UNION
         SELECT chj.chat_id FROM chat_handle_join chj
         JOIN handle h ON h.ROWID = chj.handle_id
         WHERE h.id LIKE ? ESCAPE '\\'
         UNION
         SELECT cmj2.chat_id FROM chat_message_join cmj2
         JOIN message m2 ON m2.ROWID = cmj2.message_id
         WHERE m2.text LIKE ? ESCAPE '\\'
     )
     GROUP BY c.ROWID
     ORDER BY last_row_id DESC
     LIMIT ?`,
    pattern,
    pattern,
    pattern,
    limit,
  );
  return rows.map((row) => String(row['chat_guid']));
}

function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Conversation search (plan steps 6 + 8): match group names, participant
// handles, plain message text, and — bounded — decoded attributed bodies.
// Attributed-body-only messages have no `text` column to LIKE over, so the
// most recent BODY_SCAN_LIMIT of them are decoded (through the shared cache)
// and matched in process. Bounded results; the query never logs.

import type { BodyDecoder } from '@rx/apple-body-decoder';

import { cachedBodyText, type DecodedTextCache } from '@/apple-messages/previews';
import type { MessagesReader } from '@/apple-messages/reader';

/** How many recent attributed-body-only messages one search decodes. */
export const BODY_SCAN_LIMIT = 2_000;

/** Chat GUIDs matching the query, most recently active first. */
export function searchChatGuids(
  reader: MessagesReader,
  query: string,
  limit: number,
  bodies?: { decoder: BodyDecoder; cache: DecodedTextCache },
): string[] {
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
  const guids = rows.map((row) => String(row['chat_guid']));

  if (bodies === undefined) {
    return guids;
  }
  const fromBodies = searchDecodedBodies(reader, bodies, query, limit);
  for (const guid of fromBodies) {
    if (!guids.includes(guid)) {
      guids.push(guid);
    }
  }
  return guids.slice(0, limit);
}

/** Chats whose recent attributed-body-only messages contain the query. */
function searchDecodedBodies(
  reader: MessagesReader,
  bodies: { decoder: BodyDecoder; cache: DecodedTextCache },
  query: string,
  limit: number,
): string[] {
  const rows = reader.all(
    `SELECT m.ROWID AS row_id, m.attributedBody AS attributed_body, c.guid AS chat_guid
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     JOIN chat c ON c.ROWID = cmj.chat_id
     WHERE m.text IS NULL AND m.attributedBody IS NOT NULL
     ORDER BY m.ROWID DESC
     LIMIT ?`,
    BODY_SCAN_LIMIT,
  );
  const needle = query.toLowerCase();
  const matched: string[] = [];
  for (const row of rows) {
    const chatGuid = String(row['chat_guid']);
    if (matched.includes(chatGuid)) {
      continue;
    }
    const blob = row['attributed_body'];
    if (!(blob instanceof Uint8Array)) {
      continue;
    }
    const text = cachedBodyText(bodies.decoder, bodies.cache, Number(row['row_id']), blob);
    if (text !== null && text.toLowerCase().includes(needle)) {
      matched.push(chatGuid);
      if (matched.length >= limit) {
        break;
      }
    }
  }
  return matched;
}

function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

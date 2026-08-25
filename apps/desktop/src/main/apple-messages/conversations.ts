// Conversation summaries (plan step 4 `conversations`): participants, source
// unread metadata, and latest inbound identity. Bounded queries only; no
// message bodies are decoded or returned here.

import { appleMs, type MessagesReader } from '@/apple-messages/reader';

export interface ConversationSummary {
  chatGuid: string;
  /** Group display name when set; null for unnamed chats. */
  displayName: string | null;
  /** Raw participant handles (phone numbers, emails) in join order. */
  participantHandles: string[];
  isGroup: boolean;
  lastActivityAtMs: number;
  /** Local cursor of the latest message; not durable identity. */
  lastMessageRowId: number;
  /** Latest inbound message identity, for watermarks. Null if none. */
  lastInboundGuid: string | null;
  lastInboundRowId: number | null;
  /** Source unread metadata: inbound messages with is_read = 0. */
  unreadCount: number;
}

export interface LatestRefs {
  /** Newest message in either direction; null for an empty chat. */
  latest: { guid: string; rowId: number } | null;
  /** Newest inbound message; null if the chat has none. */
  latestInbound: { guid: string; rowId: number } | null;
}

/** Fetch the watermark candidates workflow transitions record. */
export function latestRefs(reader: MessagesReader, chatGuid: string): LatestRefs {
  const one = (inboundOnly: boolean) =>
    reader.get(
      `SELECT m.guid AS guid, m.ROWID AS row_id
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       JOIN chat c ON c.ROWID = cmj.chat_id
       WHERE c.guid = ? ${inboundOnly ? 'AND m.is_from_me = 0' : ''}
       ORDER BY m.ROWID DESC
       LIMIT 1`,
      chatGuid,
    );
  const toRef = (row: ReturnType<typeof one>) =>
    row === undefined ? null : { guid: String(row['guid']), rowId: Number(row['row_id']) };
  return { latest: toRef(one(false)), latestInbound: toRef(one(true)) };
}

export function listConversationSummaries(
  reader: MessagesReader,
  options: { limit: number; chatGuids?: string[] | undefined },
): ConversationSummary[] {
  const guidFilter =
    options.chatGuids === undefined
      ? ''
      : `WHERE c.guid IN (${options.chatGuids.map(() => '?').join(', ')})`;
  const chats = reader.all(
    `SELECT c.ROWID AS chat_row_id,
            c.guid AS chat_guid,
            NULLIF(c.display_name, '') AS display_name,
            c.style AS style,
            MAX(m.ROWID) AS last_message_row_id,
            MAX(${appleMs('m.date')}) AS last_activity_ms
     FROM chat c
     JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
     JOIN message m ON m.ROWID = cmj.message_id
     ${guidFilter}
     GROUP BY c.ROWID
     ORDER BY last_activity_ms DESC
     LIMIT ?`,
    ...(options.chatGuids ?? []),
    options.limit,
  );

  return chats.map((chat) => {
    const chatRowId = Number(chat['chat_row_id']);

    const participants = reader.all(
      `SELECT h.id AS handle
       FROM chat_handle_join chj
       JOIN handle h ON h.ROWID = chj.handle_id
       WHERE chj.chat_id = ?
       ORDER BY chj.handle_id`,
      chatRowId,
    );

    const lastInbound = reader.get(
      `SELECT m.guid AS guid, m.ROWID AS row_id
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       WHERE cmj.chat_id = ? AND m.is_from_me = 0
       ORDER BY m.ROWID DESC
       LIMIT 1`,
      chatRowId,
    );

    const unread = reader.get(
      `SELECT COUNT(*) AS unread
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       WHERE cmj.chat_id = ? AND m.is_from_me = 0 AND m.is_read = 0`,
      chatRowId,
    );

    // style 43 is a group chat, 45 a one-to-one chat.
    return {
      chatGuid: String(chat['chat_guid']),
      displayName: chat['display_name'] === null ? null : String(chat['display_name']),
      participantHandles: participants.map((row) => String(row['handle'])),
      isGroup: Number(chat['style']) === 43,
      lastActivityAtMs: Number(chat['last_activity_ms']),
      lastMessageRowId: Number(chat['last_message_row_id']),
      lastInboundGuid: lastInbound ? String(lastInbound['guid']) : null,
      lastInboundRowId: lastInbound ? Number(lastInbound['row_id']) : null,
      unreadCount: Number(unread?.['unread'] ?? 0),
    };
  });
}

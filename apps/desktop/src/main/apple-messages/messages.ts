// Thread history paging (plan step 4 `messages`). Attributed bodies are
// delegated to the decoder boundary; every row classifies into a typed item,
// and anything unrecognizable becomes an explicit fallback rather than a
// blank bubble (spec/v0.md §4.3).

import type { BodyDecoder } from '@rx/apple-body-decoder';
import type { Span } from '@rx/contract';

import { appleMs, type MessagesReader, type SqlRow } from '@/apple-messages/reader';

export type MessageItem =
  | {
      kind: 'text';
      base: MessageBase;
      text: string;
      spans: Span[];
      editedAtMs: number | null;
      hasAttachments: boolean;
    }
  | {
      kind: 'tapback';
      base: MessageBase;
      /** Raw associated_message_type; 2000–2999 add, 3000–3999 remove. */
      tapbackType: number;
      added: boolean;
      targetMessageGuid: string | null;
    }
  | {
      kind: 'group-event';
      base: MessageBase;
      /** Raw item_type: 1 member change, 2 name change, 3 member left. */
      itemType: number;
      groupTitle: string | null;
    }
  | {
      kind: 'unsupported';
      base: MessageBase;
      reason: 'balloon-app' | 'undecodable-body' | 'empty';
      balloonBundleId: string | null;
      hasAttachments: boolean;
    };

export interface MessageBase {
  guid: string;
  rowId: number;
  isFromMe: boolean;
  senderHandle: string | null;
  sentAtMs: number;
}

export interface MessagePage {
  items: MessageItem[];
  /** Pass as `beforeRowId` to fetch the next older page; null when exhausted. */
  nextBeforeRowId: number | null;
}

export function pageMessages(
  reader: MessagesReader,
  decoder: BodyDecoder,
  chatGuid: string,
  options: { limit: number; beforeRowId?: number | undefined },
): MessagePage {
  const rows = reader.all(
    `SELECT m.ROWID AS row_id,
            m.guid AS guid,
            m.text AS text,
            m.attributedBody AS attributed_body,
            ${appleMs('m.date')} AS sent_at_ms,
            m.is_from_me AS is_from_me,
            m.item_type AS item_type,
            m.group_title AS group_title,
            m.associated_message_guid AS associated_guid,
            m.associated_message_type AS associated_type,
            m.balloon_bundle_id AS balloon_bundle_id,
            CASE WHEN m.date_edited > 0 THEN ${appleMs('m.date_edited')} ELSE 0 END AS edited_at_ms,
            m.cache_has_attachments AS has_attachments,
            h.id AS sender_handle
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     JOIN chat c ON c.ROWID = cmj.chat_id
     LEFT JOIN handle h ON h.ROWID = m.handle_id
     WHERE c.guid = ? AND m.ROWID < ?
     ORDER BY m.ROWID DESC
     LIMIT ?`,
    chatGuid,
    options.beforeRowId ?? Number.MAX_SAFE_INTEGER,
    options.limit,
  );

  const items = rows.map((row) => classify(row, decoder)).reverse();
  const nextBeforeRowId =
    rows.length === options.limit ? Number(rows[rows.length - 1]?.['row_id']) : null;
  return { items, nextBeforeRowId };
}

function classify(row: SqlRow, decoder: BodyDecoder): MessageItem {
  const base: MessageBase = {
    guid: String(row['guid']),
    rowId: Number(row['row_id']),
    isFromMe: Number(row['is_from_me']) === 1,
    senderHandle: row['sender_handle'] === null ? null : String(row['sender_handle']),
    sentAtMs: Number(row['sent_at_ms']),
  };
  const hasAttachments = Number(row['has_attachments']) === 1;

  const associatedType = Number(row['associated_type'] ?? 0);
  if (associatedType >= 2000 && associatedType < 4000) {
    return {
      kind: 'tapback',
      base,
      tapbackType: associatedType,
      added: associatedType < 3000,
      targetMessageGuid:
        row['associated_guid'] === null
          ? null
          : normalizeTargetGuid(String(row['associated_guid'])),
    };
  }

  const itemType = Number(row['item_type'] ?? 0);
  if (itemType !== 0) {
    return {
      kind: 'group-event',
      base,
      itemType,
      groupTitle: row['group_title'] === null ? null : String(row['group_title']),
    };
  }

  const balloonBundleId =
    row['balloon_bundle_id'] === null ? null : String(row['balloon_bundle_id']);
  const body = decodeBody(row, decoder);
  if (body !== null) {
    return {
      kind: 'text',
      base,
      text: body.text,
      spans: body.spans,
      editedAtMs: Number(row['edited_at_ms'] ?? 0) > 0 ? Number(row['edited_at_ms']) : null,
      hasAttachments,
    };
  }
  if (balloonBundleId !== null) {
    return { kind: 'unsupported', base, reason: 'balloon-app', balloonBundleId, hasAttachments };
  }
  return {
    kind: 'unsupported',
    base,
    reason: row['attributed_body'] === null ? 'empty' : 'undecodable-body',
    balloonBundleId: null,
    hasAttachments,
  };
}

function decodeBody(row: SqlRow, decoder: BodyDecoder): { text: string; spans: Span[] } | null {
  const attributedBody = row['attributed_body'];
  if (attributedBody instanceof Uint8Array) {
    const result = decoder.decode(attributedBody);
    if ('ok' in result) {
      return result.ok;
    }
  }
  const text = row['text'];
  if (typeof text === 'string' && text.length > 0) {
    return { text, spans: [] };
  }
  return null;
}

/** Tapback targets are stored as `p:0/<guid>` or `bp:<guid>`. */
function normalizeTargetGuid(raw: string): string {
  const slash = raw.indexOf('/');
  if (raw.startsWith('p:') && slash !== -1) {
    return raw.slice(slash + 1);
  }
  if (raw.startsWith('bp:')) {
    return raw.slice(3);
  }
  return raw;
}

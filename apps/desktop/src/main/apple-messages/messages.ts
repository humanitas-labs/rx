// Thread history paging (plan step 4 `messages`, extended in step 9 with
// reply relationships, custom tapback emoji, and attachment metadata).
// Attributed bodies are delegated to the decoder boundary; every row
// classifies into a typed item, and anything unrecognizable becomes an
// explicit fallback rather than a blank bubble (spec/v0.md §4.3).

import type { BodyDecoder } from '@rx/apple-body-decoder';
import type { Span } from '@rx/contract';

import { listAttachments, type AttachmentMeta } from '@/apple-messages/attachments';
import { appleMs, type MessagesReader, type SqlRow } from '@/apple-messages/reader';

export interface AttachmentView {
  guid: string;
  transferName: string | null;
  mimeType: string | null;
  totalBytes: number;
  /** The file exists locally; absolute paths never cross to the renderer. */
  present: boolean;
}

export type MessageItem =
  | {
      kind: 'text';
      base: MessageBase;
      text: string;
      spans: Span[];
      editedAtMs: number | null;
      hasAttachments: boolean;
      attachments: AttachmentView[];
      /** GUID of the message this replies to (thread_originator_guid). */
      replyToGuid: string | null;
    }
  | {
      kind: 'tapback';
      base: MessageBase;
      /** Raw associated_message_type; 2000–2999 add, 3000–3999 remove. */
      tapbackType: number;
      added: boolean;
      targetMessageGuid: string | null;
      /** Custom-emoji reactions (type 2006/3006) carry the emoji itself. */
      emoji: string | null;
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
      attachments: AttachmentView[];
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

// The reply and custom-emoji columns arrived in later macOS releases; probe
// once per reader and substitute NULL so older databases still page.
const columnSupport = new WeakMap<MessagesReader, { reply: boolean; emoji: boolean }>();

function supportedColumns(reader: MessagesReader): { reply: boolean; emoji: boolean } {
  const cached = columnSupport.get(reader);
  if (cached !== undefined) {
    return cached;
  }
  const names = new Set(
    reader.all(`SELECT name FROM pragma_table_info('message')`).map((row) => String(row['name'])),
  );
  const support = {
    reply: names.has('thread_originator_guid'),
    emoji: names.has('associated_message_emoji'),
  };
  columnSupport.set(reader, support);
  return support;
}

export function pageMessages(
  reader: MessagesReader,
  decoder: BodyDecoder,
  chatGuid: string,
  options: { limit: number; beforeRowId?: number | undefined },
): MessagePage {
  const columns = supportedColumns(reader);
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
            ${columns.emoji ? 'm.associated_message_emoji' : 'NULL'} AS associated_emoji,
            ${columns.reply ? 'm.thread_originator_guid' : 'NULL'} AS reply_to_guid,
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

  const attachmentsByRow = groupAttachments(
    listAttachments(
      reader,
      rows
        .filter((row) => Number(row['has_attachments']) === 1)
        .map((row) => Number(row['row_id'])),
    ),
  );
  const items = rows.map((row) => classify(row, decoder, attachmentsByRow)).reverse();
  const nextBeforeRowId =
    rows.length === options.limit ? Number(rows[rows.length - 1]?.['row_id']) : null;
  return { items, nextBeforeRowId };
}

function groupAttachments(metas: AttachmentMeta[]): Map<number, AttachmentView[]> {
  const byRow = new Map<number, AttachmentView[]>();
  for (const meta of metas) {
    const views = byRow.get(meta.messageRowId) ?? [];
    views.push({
      guid: meta.guid,
      transferName: meta.transferName,
      mimeType: meta.mimeType,
      totalBytes: meta.totalBytes,
      present: meta.path !== null,
    });
    byRow.set(meta.messageRowId, views);
  }
  return byRow;
}

function classify(
  row: SqlRow,
  decoder: BodyDecoder,
  attachmentsByRow: Map<number, AttachmentView[]>,
): MessageItem {
  const base: MessageBase = {
    guid: String(row['guid']),
    rowId: Number(row['row_id']),
    isFromMe: Number(row['is_from_me']) === 1,
    senderHandle: row['sender_handle'] === null ? null : String(row['sender_handle']),
    sentAtMs: Number(row['sent_at_ms']),
  };
  const hasAttachments = Number(row['has_attachments']) === 1;
  const attachments = attachmentsByRow.get(base.rowId) ?? [];

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
      emoji: row['associated_emoji'] === null ? null : String(row['associated_emoji']),
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

  const replyToGuid = row['reply_to_guid'] === null ? null : String(row['reply_to_guid']);
  const balloonBundleId =
    row['balloon_bundle_id'] === null ? null : String(row['balloon_bundle_id']);
  const body = decodeBody(row, decoder);
  if (body !== null) {
    // Attachment messages embed U+FFFC placeholders; a body that is only
    // placeholders renders as attachments alone.
    const placeholderOnly =
      attachments.length > 0 && body.text.replace(/￼/g, '').trim().length === 0;
    return {
      kind: 'text',
      base,
      text: placeholderOnly ? '' : body.text,
      spans: placeholderOnly ? [] : body.spans,
      editedAtMs: Number(row['edited_at_ms'] ?? 0) > 0 ? Number(row['edited_at_ms']) : null,
      hasAttachments,
      attachments,
      replyToGuid,
    };
  }
  if (balloonBundleId !== null) {
    return {
      kind: 'unsupported',
      base,
      reason: 'balloon-app',
      balloonBundleId,
      hasAttachments,
      attachments,
    };
  }
  if (hasAttachments) {
    // Attachment-only message: renderable, just without a text bubble.
    return {
      kind: 'text',
      base,
      text: '',
      spans: [],
      editedAtMs: null,
      hasAttachments,
      attachments,
      replyToGuid,
    };
  }
  return {
    kind: 'unsupported',
    base,
    reason: row['attributed_body'] === null ? 'empty' : 'undecodable-body',
    balloonBundleId: null,
    hasAttachments,
    attachments,
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

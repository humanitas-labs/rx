// Delivery verification (plan step 10): after automation runs, the send is
// real only when the matching outgoing record appears in the intended
// conversation past the pre-send cursor (spec/v0.md §4.4). Outbound bodies
// land in attributedBody, not text (spike 3a) — matching decodes.

import type { BodyDecoder } from '@rx/apple-body-decoder';

import { appleMs, type MessagesReader, type SqlRow } from '@/apple-messages/reader';
import type { SendTarget } from '@/delivery/send';

export interface VerifiedOutbound {
  messageGuid: string;
  rowId: number;
  chatGuid: string;
  sentAtMs: number;
}

/** Snapshot the source high-water mark before the automation runs. */
export function sourceCursor(reader: MessagesReader): number {
  const row = reader.get('SELECT COALESCE(MAX(ROWID), 0) AS max_row FROM message');
  return Number(row?.['max_row'] ?? 0);
}

/**
 * Find the outgoing record for this send: newer than the cursor, from me,
 * a plain message (no tapback/announcement), in the intended conversation,
 * with the exact sent text. A row anywhere else never matches
 * (wrong-target prevention).
 */
export function findVerifiedOutbound(
  reader: MessagesReader,
  decoder: BodyDecoder,
  options: { target: SendTarget; afterRowId: number; text: string },
): VerifiedOutbound | null {
  const chatFilter =
    options.target.kind === 'chat'
      ? `c.guid = ?`
      : // New one-to-one: Messages creates/routes to `<service>;-;<handle>`.
        `c.guid LIKE '%;-;' || ? AND c.style = 45`;
  const rows = reader.all(
    `SELECT m.ROWID AS row_id,
            m.guid AS guid,
            m.text AS text,
            m.attributedBody AS attributed_body,
            ${appleMs('m.date')} AS sent_at_ms,
            c.guid AS chat_guid
     FROM message m
     JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
     JOIN chat c ON c.ROWID = cmj.chat_id
     WHERE m.ROWID > ?
       AND m.is_from_me = 1
       AND m.item_type = 0
       AND m.associated_message_type = 0
       AND ${chatFilter}
     ORDER BY m.ROWID ASC`,
    options.afterRowId,
    options.target.kind === 'chat' ? options.target.chatGuid : options.target.handle,
  );
  for (const row of rows) {
    if (bodyText(row, decoder) === options.text) {
      return {
        messageGuid: String(row['guid']),
        rowId: Number(row['row_id']),
        chatGuid: String(row['chat_guid']),
        sentAtMs: Number(row['sent_at_ms']),
      };
    }
  }
  return null;
}

function bodyText(row: SqlRow, decoder: BodyDecoder): string | null {
  const attributedBody = row['attributed_body'];
  if (attributedBody instanceof Uint8Array) {
    const result = decoder.decode(attributedBody);
    if ('ok' in result) {
      return result.ok.text;
    }
  }
  const text = row['text'];
  return typeof text === 'string' ? text : null;
}

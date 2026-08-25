// Attachment metadata (plan step 4 `attachments`): safe local metadata and
// resolved paths for given messages. Never reads attachment contents.

import { homedir } from 'node:os';

import type { MessagesReader } from '@/apple-messages/reader';

export interface AttachmentMeta {
  messageRowId: number;
  guid: string;
  /** Absolute local path with `~` expanded; null when not locally present. */
  path: string | null;
  transferName: string | null;
  mimeType: string | null;
  totalBytes: number;
}

export function listAttachments(
  reader: MessagesReader,
  messageRowIds: readonly number[],
): AttachmentMeta[] {
  if (messageRowIds.length === 0) {
    return [];
  }
  const placeholders = messageRowIds.map(() => '?').join(', ');
  const rows = reader.all(
    `SELECT maj.message_id AS message_row_id,
            a.guid AS guid,
            a.filename AS filename,
            a.transfer_name AS transfer_name,
            a.mime_type AS mime_type,
            a.total_bytes AS total_bytes
     FROM message_attachment_join maj
     JOIN attachment a ON a.ROWID = maj.attachment_id
     WHERE maj.message_id IN (${placeholders})
     ORDER BY maj.message_id, a.ROWID`,
    ...messageRowIds,
  );
  return rows.map((row) => ({
    messageRowId: Number(row['message_row_id']),
    guid: String(row['guid']),
    path: row['filename'] === null ? null : expandHome(String(row['filename'])),
    transferName: row['transfer_name'] === null ? null : String(row['transfer_name']),
    mimeType: row['mime_type'] === null ? null : String(row['mime_type']),
    totalBytes: Number(row['total_bytes'] ?? 0),
  }));
}

function expandHome(path: string): string {
  return path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path;
}

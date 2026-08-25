// One-line conversation previews (plan step 8 row anatomy): classify the
// latest message the way the thread does, but reduce it to a single line.
// Decoded attributed bodies are cached by message ROWID so list refreshes
// and search keystrokes never re-decode the same blob.

import type { BodyDecoder } from '@rx/apple-body-decoder';

/** Decoded-text cache keyed by message ROWID; null = decode failed. */
export type DecodedTextCache = Map<number, string | null>;

const CACHE_LIMIT = 4_000;

/** Decode a message's body text through the cache; null when undecodable. */
export function cachedBodyText(
  decoder: BodyDecoder,
  cache: DecodedTextCache,
  rowId: number,
  attributedBody: Uint8Array,
): string | null {
  const hit = cache.get(rowId);
  if (hit !== undefined) {
    return hit;
  }
  const result = decoder.decode(attributedBody);
  const text = 'ok' in result ? result.ok.text : null;
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(rowId, text);
  return text;
}

export interface PreviewRow {
  rowId: number;
  text: string | null;
  attributedBody: Uint8Array | null;
  itemType: number;
  associatedType: number;
  balloonBundleId: string | null;
  hasAttachments: boolean;
  isFromMe: boolean;
}

/** Reduce the latest message to the row's one-line preview. */
export function previewFor(
  decoder: BodyDecoder,
  cache: DecodedTextCache,
  row: PreviewRow,
): string | null {
  if (row.associatedType >= 2000 && row.associatedType < 4000) {
    return row.isFromMe ? 'You reacted to a message' : 'Reacted to a message';
  }
  if (row.itemType !== 0) {
    return 'Group updated';
  }
  const text =
    row.attributedBody !== null
      ? cachedBodyText(decoder, cache, row.rowId, row.attributedBody)
      : row.text;
  const body = text ?? row.text;
  if (body !== null && body.trim().length > 0) {
    const line = body.split('\n', 1)[0] ?? body;
    return row.isFromMe ? `You: ${line}` : line;
  }
  if (row.balloonBundleId !== null) {
    return 'App message';
  }
  if (row.hasAttachments) {
    return 'Attachment';
  }
  return null;
}

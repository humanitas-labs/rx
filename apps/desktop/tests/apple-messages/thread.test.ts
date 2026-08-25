// Step 9 source coverage: reply relationships, custom tapback emoji,
// attachment metadata on page items, attachment-only classification, and
// the legacy-schema column fallback.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDecoder, type BodyDecoder } from '@rx/apple-body-decoder';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachmentPathByGuid } from '@/apple-messages/attachments';
import { pageMessages, type MessageItem } from '@/apple-messages/messages';
import { openMessagesDatabase, type MessagesReader } from '@/apple-messages/reader';

import { MessagesFixture } from './fixture';

const wasmPath = fileURLToPath(
  new URL('../../../../packages/apple-body-decoder/dist/decoder.wasm', import.meta.url),
);

const CHAT = 'chat000step9-thread';
const T0 = 1_756_100_000_000;

function buildThreadFixture(dir: string, options: { legacyColumns?: boolean } = {}) {
  const f = new MessagesFixture(dir, options);
  f.addChat(1, CHAT, { displayName: 'Step 9 Group', group: true });
  f.addHandle(1, '+15550000001');
  f.addHandle(2, 'fixture@example.com');
  f.joinHandle(1, 1);
  f.joinHandle(1, 2);

  f.addMessage({ rowId: 1, guid: 'S-1', chatRowId: 1, text: 'root message', atMs: T0, handleRowId: 1 });
  if (!options.legacyColumns) {
    f.addMessage({
      rowId: 2,
      guid: 'S-2',
      chatRowId: 1,
      text: 'a reply',
      atMs: T0 + 1_000,
      fromMe: true,
      replyToGuid: 'S-1',
    });
    // Standard tapback added then removed by the same sender — nets to zero.
    f.addMessage({
      rowId: 3,
      guid: 'S-3',
      chatRowId: 1,
      associatedGuid: 'p:0/S-1',
      associatedType: 2001,
      atMs: T0 + 2_000,
      handleRowId: 1,
    });
    f.addMessage({
      rowId: 4,
      guid: 'S-4',
      chatRowId: 1,
      associatedGuid: 'p:0/S-1',
      associatedType: 3001,
      atMs: T0 + 3_000,
      handleRowId: 1,
    });
    // Custom-emoji tapback on the reply.
    f.addMessage({
      rowId: 5,
      guid: 'S-5',
      chatRowId: 1,
      associatedGuid: 'p:0/S-2',
      associatedType: 2006,
      associatedEmoji: '🔥',
      atMs: T0 + 4_000,
      handleRowId: 2,
    });
  }
  // Attachment-only message: no text, placeholder-free, one local file.
  f.addMessage({
    rowId: 6,
    guid: 'S-6',
    chatRowId: 1,
    atMs: T0 + 5_000,
    handleRowId: 2,
    hasAttachments: true,
  });
  f.addAttachment(1, 6, {
    guid: 'AT-1',
    filename: '~/Library/Messages/Attachments/aa/bb/step9-photo.png',
    transferName: 'step9-photo.png',
    mimeType: 'image/png',
    bytes: 2_048,
  });
  // Attachment never downloaded locally.
  f.addMessage({
    rowId: 7,
    guid: 'S-7',
    chatRowId: 1,
    text: 'file incoming',
    atMs: T0 + 6_000,
    handleRowId: 1,
    hasAttachments: true,
  });
  f.addAttachment(2, 7, { guid: 'AT-2', transferName: 'missing.pdf', mimeType: 'application/pdf' });
  // Link-preview message: URL text plus hidden pluginPayloadAttachment
  // internals that must never surface as user attachments.
  f.addMessage({
    rowId: 8,
    guid: 'S-8',
    chatRowId: 1,
    text: 'https://example.com/',
    atMs: T0 + 7_000,
    handleRowId: 1,
    hasAttachments: true,
    balloonBundleId: 'com.apple.messages.URLBalloonProvider',
  });
  f.addAttachment(3, 8, {
    guid: 'AT-3',
    filename: '~/Library/Messages/Attachments/cc/dd/payload.pluginPayloadAttachment',
    transferName: '11111111-2222-3333-4444-555555555555.pluginPayloadAttachment',
    bytes: 6_000,
  });
  return f;
}

let dir: string;
let fixture: MessagesFixture;
let reader: MessagesReader;
let decoder: BodyDecoder;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rx-thread-'));
  fixture = buildThreadFixture(dir);
  reader = openMessagesDatabase(fixture.path);
  decoder = await createDecoder(readFileSync(wasmPath));
});

afterAll(() => {
  reader.close();
  fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('step 9 paging', () => {
  it('carries reply relationships on text items', () => {
    const page = pageMessages(reader, decoder, CHAT, { limit: 50 });
    const reply = page.items.find((i) => i.base.guid === 'S-2') as Extract<
      MessageItem,
      { kind: 'text' }
    >;
    expect(reply.replyToGuid).toBe('S-1');
    const root = page.items.find((i) => i.base.guid === 'S-1') as Extract<
      MessageItem,
      { kind: 'text' }
    >;
    expect(root.replyToGuid).toBeNull();
  });

  it('carries custom emoji on tapback items', () => {
    const page = pageMessages(reader, decoder, CHAT, { limit: 50 });
    const custom = page.items.find((i) => i.base.guid === 'S-5') as Extract<
      MessageItem,
      { kind: 'tapback' }
    >;
    expect(custom).toMatchObject({ tapbackType: 2006, emoji: '🔥', targetMessageGuid: 'S-2' });
    const removal = page.items.find((i) => i.base.guid === 'S-4') as Extract<
      MessageItem,
      { kind: 'tapback' }
    >;
    expect(removal.added).toBe(false);
  });

  it('attaches attachment metadata and classifies attachment-only as text', () => {
    const page = pageMessages(reader, decoder, CHAT, { limit: 50 });
    const attachmentOnly = page.items.find((i) => i.base.guid === 'S-6') as Extract<
      MessageItem,
      { kind: 'text' }
    >;
    expect(attachmentOnly.kind).toBe('text');
    expect(attachmentOnly.text).toBe('');
    expect(attachmentOnly.attachments).toEqual([
      {
        guid: 'AT-1',
        transferName: 'step9-photo.png',
        mimeType: 'image/png',
        totalBytes: 2_048,
        present: true,
      },
    ]);

    const withFile = page.items.find((i) => i.base.guid === 'S-7') as Extract<
      MessageItem,
      { kind: 'text' }
    >;
    expect(withFile.text).toBe('file incoming');
    expect(withFile.attachments[0]).toMatchObject({ guid: 'AT-2', present: false });
  });

  it('hides link-preview payload internals, leaving the URL text bubble', () => {
    const page = pageMessages(reader, decoder, CHAT, { limit: 50 });
    const link = page.items.find((i) => i.base.guid === 'S-8') as Extract<
      MessageItem,
      { kind: 'text' }
    >;
    expect(link.kind).toBe('text');
    expect(link.text).toBe('https://example.com/');
    expect(link.attachments).toEqual([]);
  });

  it('resolves attachment paths by guid only inside ~/Library/Messages', () => {
    const resolved = attachmentPathByGuid(reader, 'AT-1');
    expect(resolved?.path.endsWith('/Library/Messages/Attachments/aa/bb/step9-photo.png')).toBe(
      true,
    );
    expect(resolved?.mimeType).toBe('image/png');
    expect(attachmentPathByGuid(reader, 'AT-2')).toBeNull(); // no local file
    expect(attachmentPathByGuid(reader, 'nope')).toBeNull();
  });

  it('pages a legacy schema without reply/emoji columns', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'rx-thread-legacy-'));
    const legacy = buildThreadFixture(legacyDir, { legacyColumns: true });
    const legacyReader = openMessagesDatabase(legacy.path);
    const page = pageMessages(legacyReader, decoder, CHAT, { limit: 50 });
    const first = page.items[0] as Extract<MessageItem, { kind: 'text' }>;
    expect(first.text).toBe('root message');
    expect(first.replyToGuid).toBeNull();
    legacyReader.close();
    legacy.close();
    rmSync(legacyDir, { recursive: true, force: true });
  });
});

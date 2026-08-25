import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDecoder, type BodyDecoder } from '@rx/apple-body-decoder';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listAttachments } from '@/apple-messages/attachments';
import { checkCapabilities, findMissingTables } from '@/apple-messages/capabilities';
import { listConversationSummaries } from '@/apple-messages/conversations';
import { createSourceObserver } from '@/apple-messages/events';
import { pageMessages, type MessageItem } from '@/apple-messages/messages';
import { openMessagesDatabase, type MessagesReader } from '@/apple-messages/reader';

import { buildStandardFixture, FIXTURE_BODY_TEXT, MessagesFixture } from './fixture';

const wasmPath = fileURLToPath(
  new URL('../../../../packages/apple-body-decoder/dist/decoder.wasm', import.meta.url),
);

let dir: string;
let fixture: MessagesFixture;
let reader: MessagesReader;
let decoder: BodyDecoder;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rx-fixture-'));
  fixture = buildStandardFixture(dir);
  reader = openMessagesDatabase(fixture.path);
  decoder = await createDecoder(readFileSync(wasmPath));
});

afterAll(() => {
  reader.close();
  fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('capabilities', () => {
  it('reports full capability on the fixture database', () => {
    const caps = checkCapabilities(fixture.path);
    expect(caps.database).toBe('ok');
    expect(caps.missingTables).toEqual([]);
  });

  it('reports a missing database as not-found', () => {
    expect(checkCapabilities(join(dir, 'nope.db')).database).toBe('not-found');
  });

  it('detects schema drift as missing tables', () => {
    const driftDir = mkdtempSync(join(tmpdir(), 'rx-drift-'));
    const drifted = new MessagesFixture(driftDir, { omitTables: ['attachment'] });
    const driftReader = openMessagesDatabase(drifted.path);
    expect(findMissingTables(driftReader)).toEqual(['attachment']);
    driftReader.close();
    drifted.close();
    rmSync(driftDir, { recursive: true, force: true });
  });
});

describe('conversation summaries', () => {
  it('lists summaries ordered by latest activity with unread and inbound identity', () => {
    const summaries = listConversationSummaries(reader, { limit: 10 });
    expect(summaries).toHaveLength(2);

    const [group, direct] = summaries;
    expect(group?.chatGuid).toBe('chat000fixture-group');
    expect(group?.displayName).toBe('Fixture Group');
    expect(group?.isGroup).toBe(true);
    expect(group?.participantHandles).toEqual(['+15550000001', 'fixture@example.com']);
    expect(group?.lastInboundGuid).toBe('G-8');
    expect(group?.unreadCount).toBe(1); // the attachment message is unread

    expect(direct?.chatGuid).toBe('iMessage;-;fixture-direct');
    expect(direct?.displayName).toBeNull();
    expect(direct?.isGroup).toBe(false);
    expect(direct?.lastInboundGuid).toBe('G-3');
    expect(direct?.unreadCount).toBe(1); // the attributedBody message is unread
  });

  it('respects the limit bound', () => {
    expect(listConversationSummaries(reader, { limit: 1 })).toHaveLength(1);
  });
});

describe('message paging and classification', () => {
  it('decodes text, attributedBody, and edit state in the direct chat', () => {
    const page = pageMessages(reader, decoder, 'iMessage;-;fixture-direct', { limit: 50 });
    expect(page.items.map((item) => item.kind)).toEqual(['text', 'text', 'text']);
    expect(page.nextBeforeRowId).toBeNull();

    const [plain, outbound, attributed] = page.items as Extract<MessageItem, { kind: 'text' }>[];
    expect(plain?.text).toBe('plain inbound');
    expect(plain?.base.senderHandle).toBe('+15550000001');
    expect(outbound?.base.isFromMe).toBe(true);
    expect(attributed?.text).toBe(FIXTURE_BODY_TEXT);
    expect(attributed?.spans).toEqual([]);
  });

  it('classifies every non-text content type in the group chat', () => {
    const page = pageMessages(reader, decoder, 'chat000fixture-group', { limit: 50 });
    expect(page.items.map((item) => item.kind)).toEqual([
      'group-event',
      'tapback',
      'unsupported',
      'text',
      'text',
    ]);

    const [event, tapback, balloon, edited, attachment] = page.items;
    expect(event).toMatchObject({ itemType: 2, groupTitle: 'Fixture Group' });
    expect(tapback).toMatchObject({ tapbackType: 2000, added: true, targetMessageGuid: 'G-2' });
    expect(balloon).toMatchObject({
      reason: 'balloon-app',
      balloonBundleId: 'com.example.fixture-balloon',
    });
    expect(edited).toMatchObject({ kind: 'text', text: 'edited outbound' });
    expect((edited as Extract<MessageItem, { kind: 'text' }>).editedAtMs).toBeGreaterThan(0);
    expect(attachment).toMatchObject({ kind: 'text', hasAttachments: true });
  });

  it('pages older history through nextBeforeRowId', () => {
    const first = pageMessages(reader, decoder, 'chat000fixture-group', { limit: 2 });
    expect(first.items.map((item) => item.base.rowId)).toEqual([7, 8]);
    expect(first.nextBeforeRowId).toBe(7);

    const older = pageMessages(reader, decoder, 'chat000fixture-group', {
      limit: 2,
      beforeRowId: first.nextBeforeRowId ?? undefined,
    });
    expect(older.items.map((item) => item.base.rowId)).toEqual([5, 6]);
  });
});

describe('attachments', () => {
  it('resolves metadata with expanded local paths', () => {
    const attachments = listAttachments(reader, [8]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      messageRowId: 8,
      guid: 'A-1',
      transferName: 'fixture-photo.heic',
      mimeType: 'image/heic',
      totalBytes: 12_345,
    });
    expect(attachments[0]?.path).toBe(
      `${homedir()}/Library/Messages/Attachments/ab/cd/fixture-photo.heic`,
    );
  });

  it('returns nothing for messages without attachments', () => {
    expect(listAttachments(reader, [1, 2])).toEqual([]);
  });
});

describe('source observer', () => {
  it('starts at the current cursor, reports affected chats once, then goes quiet', () => {
    const events: unknown[] = [];
    const observer = createSourceObserver({
      reader,
      dbPath: fixture.path,
      onEvent: (event) => events.push(event),
    });
    expect(observer.cursor).toBe(8);
    expect(observer.check()).toBeNull();

    fixture.addMessage({
      rowId: 9,
      guid: 'G-9',
      chatRowId: 1,
      text: 'late arrival',
      atMs: 1_756_000_100_000,
      handleRowId: 1,
    });

    const event = observer.check();
    expect(event).toMatchObject({
      kind: 'messages-added',
      cursor: 9,
      chats: [{ chatGuid: 'iMessage;-;fixture-direct', latestRowId: 9, hasInbound: true }],
    });
    expect(events).toHaveLength(1);
    expect(observer.check()).toBeNull();
    expect(observer.cursor).toBe(9);
  });
});

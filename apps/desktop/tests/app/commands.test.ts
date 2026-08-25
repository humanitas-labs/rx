// Step 6 integration tests: the full command surface against the synthetic
// chat.db fixture and a real workflow store. Every call goes through
// guardCommand, so requests and responses are validated against the IPC
// contract exactly as they are in production.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDecoder, type BodyDecoder } from '@rx/apple-body-decoder';
import type { CommandName, CommandRequest, CommandResponse } from '@rx/contract';
import { openWorkflowStore, type WorkflowStore } from '@rx/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCommands, type CommandHandlers } from '@/app/commands';
import { openMessagesDatabase, type MessagesReader } from '@/apple-messages';
import { guardCommand } from '@/ipc/registry';

import { buildStandardFixture, type MessagesFixture } from '../apple-messages/fixture';

const wasmPath = fileURLToPath(
  new URL('../../../../packages/apple-body-decoder/dist/decoder.wasm', import.meta.url),
);

const DIRECT = 'iMessage;-;fixture-direct';
const GROUP = 'chat000fixture-group';
const T0 = 1_756_000_000_000;
const NOW = T0 + 100_000;

let decoder: BodyDecoder;
let dir: string;
let fixture: MessagesFixture;
let reader: MessagesReader;
let store: WorkflowStore;
let handlers: CommandHandlers;

beforeAll(async () => {
  decoder = await createDecoder(readFileSync(wasmPath));
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rx-app-'));
  fixture = buildStandardFixture(dir);
  reader = openMessagesDatabase(fixture.path);
  store = openWorkflowStore(join(dir, 'workflow.db'));
  handlers = createCommands({
    reader,
    decoder,
    store,
    messagesDbPath: fixture.path,
    now: () => NOW,
  });
});

afterEach(() => {
  store.close();
  reader.close();
  fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Invoke through the production guard: contract-validated both directions. */
function invoke<C extends CommandName>(
  command: C,
  request: CommandRequest<C>,
): Promise<CommandResponse<C>> {
  const handler = handlers[command];
  if (handler === undefined) {
    throw new Error(`no handler registered for ${command}`);
  }
  return guardCommand(command, handler)(request);
}

function listGuids(view: 'inbox' | 'snoozed' | 'archived', space: 'all' | 'unassigned' | number) {
  return invoke('conversations.list', { view, space, limit: 50 }).then((r) =>
    r.conversations.map((c) => c.chatGuid),
  );
}

describe('conversations.list', () => {
  it('defaults every conversation to Inbox, newest activity first', async () => {
    const { conversations } = await invoke('conversations.list', {
      view: 'inbox',
      space: 'all',
      limit: 50,
    });
    expect(conversations.map((c) => c.chatGuid)).toEqual([GROUP, DIRECT]);
    expect(conversations.map((c) => c.state)).toEqual([{ kind: 'inbox' }, { kind: 'inbox' }]);
    expect(conversations[0]).toMatchObject({
      displayName: 'Fixture Group',
      isGroup: true,
      unread: true,
      spaceId: null,
    });
  });

  it('archive moves a conversation out of Inbox and into Archive', async () => {
    await invoke('workflow.archive', { chatGuid: DIRECT });
    expect(await listGuids('inbox', 'all')).toEqual([GROUP]);
    expect(await listGuids('archived', 'all')).toEqual([DIRECT]);
  });

  it('an inbound past the archive watermark resurfaces in the read model', async () => {
    await invoke('workflow.archive', { chatGuid: GROUP });
    expect(await listGuids('inbox', 'all')).toEqual([DIRECT]);
    fixture.addMessage({
      rowId: 9,
      guid: 'G-9',
      chatRowId: 2,
      text: 'wake up',
      atMs: T0 + 9_000,
      handleRowId: 1,
    });
    expect(await listGuids('inbox', 'all')).toEqual([GROUP, DIRECT]);
  });

  it('snoozed view orders by wake time, soonest first', async () => {
    await invoke('workflow.snooze', { chatGuid: DIRECT, wakeAt: NOW + 60_000 });
    await invoke('workflow.snooze', { chatGuid: GROUP, wakeAt: NOW + 30_000 });
    expect(await listGuids('snoozed', 'all')).toEqual([GROUP, DIRECT]);
    expect(await listGuids('inbox', 'all')).toEqual([]);
  });

  it('a due snooze reads as Inbox before any wake pass persists it', async () => {
    await invoke('workflow.snooze', { chatGuid: DIRECT, wakeAt: NOW - 1 });
    expect(await listGuids('inbox', 'all')).toEqual([GROUP, DIRECT]);
    expect(await listGuids('snoozed', 'all')).toEqual([]);
  });

  it('restore returns an archived conversation to Inbox', async () => {
    await invoke('workflow.archive', { chatGuid: DIRECT });
    await invoke('workflow.restore', { chatGuid: DIRECT });
    expect(await listGuids('inbox', 'all')).toEqual([GROUP, DIRECT]);
  });
});

describe('rx unread', () => {
  it('markSeen clears rx unread without touching source unread', async () => {
    await invoke('workflow.markSeen', { chatGuid: DIRECT });
    const { conversations } = await invoke('conversations.list', {
      view: 'inbox',
      space: 'all',
      limit: 50,
    });
    const direct = conversations.find((c) => c.chatGuid === DIRECT);
    const group = conversations.find((c) => c.chatGuid === GROUP);
    expect(direct?.unread).toBe(false);
    expect(direct?.sourceUnreadCount).toBe(1);
    expect(group?.unread).toBe(true);
  });

  it('a newer inbound makes a seen conversation unread again', async () => {
    await invoke('workflow.markSeen', { chatGuid: DIRECT });
    fixture.addMessage({
      rowId: 9,
      guid: 'G-9',
      chatRowId: 1,
      text: 'new inbound',
      atMs: T0 + 9_000,
      handleRowId: 1,
    });
    const { conversations } = await invoke('conversations.list', {
      view: 'inbox',
      space: 'all',
      limit: 50,
    });
    expect(conversations.find((c) => c.chatGuid === DIRECT)?.unread).toBe(true);
  });
});

describe('spaces scoping', () => {
  it('scopes list views by Space with All and Unassigned aggregates', async () => {
    const created = await invoke('spaces.create', { name: 'Work' });
    if (!('ok' in created)) {
      throw new Error('space creation failed');
    }
    await invoke('spaces.assign', { chatGuid: DIRECT, spaceId: created.ok.id });
    expect(await listGuids('inbox', created.ok.id)).toEqual([DIRECT]);
    expect(await listGuids('inbox', 'unassigned')).toEqual([GROUP]);
    expect(await listGuids('inbox', 'all')).toEqual([GROUP, DIRECT]);
  });

  it('deleting a Space returns members to Unassigned and keeps workflow state', async () => {
    const created = await invoke('spaces.create', { name: 'Work' });
    if (!('ok' in created)) {
      throw new Error('space creation failed');
    }
    await invoke('spaces.assign', { chatGuid: DIRECT, spaceId: created.ok.id });
    await invoke('workflow.archive', { chatGuid: DIRECT });
    await invoke('spaces.delete', { id: created.ok.id });
    expect(await listGuids('archived', 'unassigned')).toEqual([DIRECT]);
  });

  it('reports expected space failures as data', async () => {
    await invoke('spaces.create', { name: 'Work' });
    expect(await invoke('spaces.create', { name: 'Work' })).toEqual({
      err: 'duplicate-space-name',
    });
    expect(await invoke('spaces.assign', { chatGuid: DIRECT, spaceId: 99 })).toEqual({
      err: 'space-not-found',
    });
  });
});

describe('conversations.search', () => {
  it('matches message text, group names, and handles', async () => {
    expect(
      (await invoke('conversations.search', { query: 'photo incoming', space: 'all', limit: 20 }))
        .conversations[0]?.chatGuid,
    ).toBe(GROUP);
    expect(
      (await invoke('conversations.search', { query: 'Fixture Group', space: 'all', limit: 20 }))
        .conversations[0]?.chatGuid,
    ).toBe(GROUP);
    const byHandle = await invoke('conversations.search', {
      query: '+15550000001',
      space: 'all',
      limit: 20,
    });
    expect(byHandle.conversations.map((c) => c.chatGuid)).toEqual([GROUP, DIRECT]);
  });

  it('treats LIKE metacharacters literally and respects space scope', async () => {
    expect(
      (await invoke('conversations.search', { query: '%', space: 'all', limit: 20 })).conversations,
    ).toEqual([]);
    expect(
      (await invoke('conversations.search', { query: 'plain', space: 'unassigned', limit: 20 }))
        .conversations[0]?.chatGuid,
    ).toBe(DIRECT);
  });
});

describe('thread and capabilities', () => {
  it('thread.page returns contract-valid typed items', async () => {
    const page = await invoke('thread.page', { chatGuid: GROUP, limit: 3 });
    expect(page.items.map((item) => item.kind)).toEqual(['unsupported', 'text', 'text']);
    expect(page.nextBeforeRowId).toBe(6);
  });

  it('app.capabilities reports the fixture database as usable', async () => {
    expect(await invoke('app.capabilities', {})).toEqual({
      database: 'ok',
      missingTables: [],
      messagesAppPresent: true,
    });
  });

  it('source-dependent commands fail typed when the source is unavailable', async () => {
    handlers = createCommands({
      reader: null,
      decoder,
      store,
      messagesDbPath: fixture.path,
      now: () => NOW,
    });
    await expect(
      invoke('conversations.list', { view: 'inbox', space: 'all', limit: 5 }),
    ).rejects.toThrow('source-unavailable');
    expect(await invoke('spaces.list', {})).toEqual({ spaces: [] });
  });
});

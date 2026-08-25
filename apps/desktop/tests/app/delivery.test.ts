// Step 10 delivery tests: compose.send through the production guard with
// faked Messages automation over the synthetic fixture. Covers verified
// send, silent no-op, wrong-target prevention, permission denial, new
// one-to-one creation, and workflow restore semantics.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDecoder, type BodyDecoder } from '@rx/apple-body-decoder';
import type { CommandName, CommandRequest, CommandResponse } from '@rx/contract';
import { openWorkflowStore, type WorkflowStore } from '@rx/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCommands, type AppServices, type CommandHandlers } from '@/app/commands';
import { openMessagesDatabase, type MessagesReader } from '@/apple-messages';
import { classifyAutomationError, type SendAutomation } from '@/delivery/send';
import { guardCommand } from '@/ipc/registry';

import { buildStandardFixture, type MessagesFixture } from '../apple-messages/fixture';

const wasmPath = fileURLToPath(
  new URL('../../../../packages/apple-body-decoder/dist/decoder.wasm', import.meta.url),
);

const DIRECT = 'iMessage;-;fixture-direct';
const NEW_HANDLE = '+15550009999';
const NEW_CHAT = `iMessage;-;${NEW_HANDLE}`;
const T0 = 1_756_000_000_000;
const NOW = T0 + 100_000;
const FAST = { timeoutMs: 300, pollMs: 20 };

let decoder: BodyDecoder;
let dir: string;
let fixture: MessagesFixture;
let reader: MessagesReader;
let store: WorkflowStore;

beforeAll(async () => {
  decoder = await createDecoder(readFileSync(wasmPath));
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rx-delivery-'));
  fixture = buildStandardFixture(dir);
  reader = openMessagesDatabase(fixture.path);
  store = openWorkflowStore(join(dir, 'workflow.db'));
});

afterEach(() => {
  store.close();
  reader.close();
  fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeInvoke(automation: SendAutomation) {
  const services: AppServices = {
    reader,
    decoder,
    store,
    messagesDbPath: fixture.path,
    now: () => NOW,
    automation,
    deliveryTiming: FAST,
  };
  const handlers: CommandHandlers = createCommands(services);
  return function invoke<C extends CommandName>(
    command: C,
    request: CommandRequest<C>,
  ): Promise<CommandResponse<C>> {
    const handler = handlers[command];
    if (handler === undefined) {
      throw new Error(`no handler registered for ${command}`);
    }
    return guardCommand(command, handler)(request);
  };
}

/** Automation that behaves like Messages: the row appears in the source. */
function automationInserting(chatRowId: number, text: string, rowId = 100): SendAutomation {
  return () => {
    fixture.addMessage({
      rowId,
      guid: `SENT-${rowId}`,
      chatRowId,
      text,
      atMs: NOW,
      fromMe: true,
    });
    return Promise.resolve({ ok: true });
  };
}

describe('compose.send (step 10)', () => {
  it('verifies a text sent to an existing conversation', async () => {
    const invoke = makeInvoke(automationInserting(1, 'hello from rx'));
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'hello from rx',
    });
    expect(outcome).toEqual({ state: 'verified', chatGuid: DIRECT, messageGuid: 'SENT-100' });
  });

  it('treats automation success without a source record as failure', async () => {
    const invoke = makeInvoke(() => Promise.resolve({ ok: true }));
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'vanishes silently',
    });
    expect(outcome).toEqual({ state: 'failed', reason: 'not-verified' });
  });

  it('never verifies a row that landed in a different conversation', async () => {
    // The row appears in the group chat while the intended target is DIRECT.
    const invoke = makeInvoke(automationInserting(2, 'misrouted text'));
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'misrouted text',
    });
    expect(outcome).toEqual({ state: 'failed', reason: 'not-verified' });
  });

  it('does not match an older identical message before the cursor', async () => {
    // 'plain inbound' exists pre-send (and is inbound anyway); nothing new
    // appears, so the send must fail rather than match history.
    const invoke = makeInvoke(() => Promise.resolve({ ok: true }));
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'plain inbound',
    });
    expect(outcome).toEqual({ state: 'failed', reason: 'not-verified' });
  });

  it('propagates typed automation failures', async () => {
    const invoke = makeInvoke(() =>
      Promise.resolve({ ok: false as const, reason: 'permission-denied' as const }),
    );
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'never sent',
    });
    expect(outcome).toEqual({ state: 'failed', reason: 'permission-denied' });
  });

  it('verifies a new one-to-one by handle and returns the created chat', async () => {
    fixture.addChat(3, NEW_CHAT);
    const invoke = makeInvoke(automationInserting(3, 'first contact'));
    const { outcome } = await invoke('compose.send', {
      target: { kind: 'handle', handle: NEW_HANDLE },
      text: 'first contact',
    });
    expect(outcome).toEqual({ state: 'verified', chatGuid: NEW_CHAT, messageGuid: 'SENT-100' });
  });

  it('a verified send restores an archived conversation to Inbox; a failed one does not', async () => {
    const okInvoke = makeInvoke(automationInserting(1, 'resurface me'));
    await okInvoke('workflow.archive', { chatGuid: DIRECT });
    await okInvoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'resurface me',
    });
    const inbox = await okInvoke('conversations.list', { view: 'inbox', space: 'all', limit: 50 });
    expect(inbox.conversations.map((c) => c.chatGuid)).toContain(DIRECT);

    const failInvoke = makeInvoke(() => Promise.resolve({ ok: true }));
    await failInvoke('workflow.archive', { chatGuid: DIRECT });
    await failInvoke('compose.send', {
      target: { kind: 'chat', chatGuid: DIRECT },
      text: 'never lands',
    });
    const archived = await failInvoke('conversations.list', {
      view: 'archived',
      space: 'all',
      limit: 50,
    });
    expect(archived.conversations.map((c) => c.chatGuid)).toContain(DIRECT);
  });
});

describe('automation error classification', () => {
  it('maps TCC denial, missing app, and everything else', () => {
    expect(classifyAutomationError('execution error: Not authorized ... (-1743)')).toBe(
      'permission-denied',
    );
    expect(classifyAutomationError("Messages got an error: Application isn't running. (-600)")).toBe(
      'messages-unavailable',
    );
    expect(classifyAutomationError('some other apple event error (-1728)')).toBe(
      'automation-error',
    );
  });
});

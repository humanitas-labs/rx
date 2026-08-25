// Step 11 background-lifecycle tests: the runtime over the synthetic
// fixture, driven by explicit check()/wakePass() calls instead of timers.
// Covers launch catch-up, resurface persistence before notification,
// duplicate events, burst delivery, outbound rows, database lock with
// recovery (no lost rows), and the sleep/wake snooze pass.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EventName, EventPayload } from '@rx/contract';
import { openWorkflowStore, type WorkflowStore } from '@rx/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openMessagesDatabase, type MessagesReader } from '@/apple-messages';
import { startRuntime, type Runtime } from '@/runtime/runtime';

import { buildStandardFixture, type MessagesFixture } from '../apple-messages/fixture';

const DIRECT = 'iMessage;-;fixture-direct';
const GROUP = 'chat000fixture-group';
const T0 = 1_756_000_000_000;

interface Emitted {
  event: EventName;
  payload: unknown;
}

let dir: string;
let fixture: MessagesFixture;
let reader: MessagesReader;
let store: WorkflowStore;
let events: Emitted[];
let runtime: Runtime | null;
let nowMs: number;
let failSource: boolean;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rx-runtime-'));
  fixture = buildStandardFixture(dir);
  reader = openMessagesDatabase(fixture.path);
  store = openWorkflowStore(join(dir, 'workflow.db'));
  events = [];
  runtime = null;
  nowMs = T0 + 100_000;
  failSource = false;
});

afterEach(() => {
  runtime?.stop();
  store.close();
  reader.close();
  fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A reader that fails on demand, modeling a locked/unreadable database. */
function flakyReader(): MessagesReader {
  return {
    all: (sql, ...params) => {
      if (failSource) {
        throw new Error('database is locked');
      }
      return reader.all(sql, ...params);
    },
    get: (sql, ...params) => {
      if (failSource) {
        throw new Error('database is locked');
      }
      return reader.get(sql, ...params);
    },
    close: () => reader.close(),
  };
}

function start(overrides: { reader?: MessagesReader } = {}): Runtime {
  const active = startRuntime({
    getReader: () => overrides.reader ?? reader,
    dbPath: fixture.path,
    store,
    emit: (event, payload) => events.push({ event, payload }),
    now: () => nowMs,
    pollIntervalMs: 3_600_000,
    wakeIntervalMs: 3_600_000,
  });
  runtime = active;
  return active;
}

function emitted<E extends EventName>(event: E): EventPayload<E>[] {
  return events.filter((e) => e.event === event).map((e) => e.payload as EventPayload<E>);
}

function addInbound(chatRowId: number, rowId: number) {
  fixture.addMessage({
    rowId,
    guid: `live-${rowId}`,
    chatRowId,
    text: `live message ${rowId}`,
    atMs: nowMs,
    handleRowId: 1,
  });
}

describe('source events', () => {
  it('converts a new inbound row into a persisted resurface, then notifies', () => {
    store.archive(DIRECT, null, nowMs);
    start();
    addInbound(1, 100);

    runtime?.check();

    expect(store.getConversation(DIRECT)?.state.kind).toBe('inbox');
    expect(emitted('workflow.changed')).toEqual([
      { chatGuid: DIRECT, state: { kind: 'inbox' } },
    ]);
    expect(emitted('conversations.changed')).toEqual([{ chatGuids: [DIRECT] }]);
  });

  it('does not re-emit for already-seen rows (duplicate events)', () => {
    start();
    addInbound(1, 100);
    runtime?.check();
    events = [];

    runtime?.check();
    runtime?.check();

    expect(events).toEqual([]);
  });

  it('collapses a burst across conversations into one event per chat', () => {
    start();
    addInbound(1, 100);
    addInbound(1, 101);
    addInbound(2, 102);

    runtime?.check();

    const changed = emitted('conversations.changed');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.chatGuids.sort()).toEqual([DIRECT, GROUP].sort());
  });

  it('outbound-only rows notify without resurfacing an archived chat', () => {
    store.archive(DIRECT, null, nowMs);
    start();
    fixture.addMessage({
      rowId: 100,
      guid: 'live-out-100',
      chatRowId: 1,
      text: 'sent from Messages.app',
      atMs: nowMs,
      fromMe: true,
    });

    runtime?.check();

    // Unverified outbound activity is visible but never restores; only
    // compose.send's verified path does (spec §3.3).
    expect(emitted('conversations.changed')).toEqual([{ chatGuids: [DIRECT] }]);
    expect(store.getConversation(DIRECT)?.state.kind).toBe('archived');
  });
});

describe('monitoring failures', () => {
  it('reports a locked database, recovers, and loses no rows', () => {
    const flaky = flakyReader();
    start({ reader: flaky });

    failSource = true;
    runtime?.check();
    expect(emitted('source.status')).toEqual([{ observing: false, lastError: 'database is locked' }]);

    // A repeat failure does not spam the renderer.
    runtime?.check();
    expect(emitted('source.status')).toHaveLength(1);

    // Rows that arrive during the outage (e.g. Messages restarted and kept
    // delivering) are caught up on the first healthy pass.
    addInbound(1, 100);
    failSource = false;
    runtime?.check();

    expect(emitted('source.status')).toEqual([
      { observing: false, lastError: 'database is locked' },
      { observing: true, lastError: null },
    ]);
    expect(emitted('conversations.changed')).toEqual([{ chatGuids: [DIRECT] }]);
  });
});

describe('snooze wake pass', () => {
  it('wakes due snoozes on launch (catch-up while rx was closed)', () => {
    store.snooze(DIRECT, null, nowMs - 1, nowMs - 10_000);

    start();

    expect(store.getConversation(DIRECT)?.state.kind).toBe('inbox');
    expect(emitted('workflow.changed')).toEqual([
      { chatGuid: DIRECT, state: { kind: 'inbox' } },
    ]);
    expect(emitted('conversations.changed')).toEqual([{ chatGuids: [DIRECT] }]);
  });

  it('wakes a snooze that comes due while running (sleep/wake resume)', () => {
    start();
    store.snooze(DIRECT, null, nowMs + 60_000, nowMs);

    runtime?.wakePass();
    expect(store.getConversation(DIRECT)?.state.kind).toBe('snoozed');
    expect(events).toEqual([]);

    // The machine sleeps past the wake time; powerMonitor resume fires.
    nowMs += 120_000;
    runtime?.wakePass();

    expect(store.getConversation(DIRECT)?.state.kind).toBe('inbox');
    expect(emitted('conversations.changed')).toEqual([{ chatGuids: [DIRECT] }]);
  });
});

// Table-driven tests for the persistent workflow store (plan step 5 exit
// criteria): every valid transition, restart recovery, duplicate source
// events, clock boundaries, missing source conversations, idempotent replay.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MessageRef } from '@/types';
import { openWorkflowStore, type WorkflowStore } from '@/workflow';

const CHAT = 'iMessage;-;chat-fixture-1';
const OTHER = 'iMessage;-;chat-fixture-2';

function ref(rowId: number): MessageRef {
  return { guid: `G-${rowId}`, rowId };
}

let dir: string;
let store: WorkflowStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rx-workflow-'));
  store = openWorkflowStore(join(dir, 'workflow.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('workflow transitions', () => {
  it('archive stores the watermark and survives restart', () => {
    store.archive(CHAT, ref(50), 1_000);
    store.close();
    store = openWorkflowStore(join(dir, 'workflow.db'));
    expect(store.getConversation(CHAT)).toMatchObject({
      state: { kind: 'archived', inboundWatermark: 50 },
      updatedAt: 1_000,
    });
  });

  it('snooze stores wake time and watermark', () => {
    store.snooze(CHAT, ref(50), 5_000, 1_000);
    expect(store.getConversation(CHAT)?.state).toEqual({
      kind: 'snoozed',
      wakeAt: 5_000,
      inboundWatermark: 50,
    });
  });

  it('restore returns any state to inbox', () => {
    store.snooze(CHAT, ref(50), 5_000, 1_000);
    store.restore(CHAT, 2_000);
    expect(store.getConversation(CHAT)?.state).toEqual({ kind: 'inbox' });
  });

  // Duplicate source events and replay at the watermark must be no-ops.
  it.each([
    ['at the watermark', 50, false],
    ['before the watermark', 49, false],
    ['after the watermark', 51, true],
  ])('inbound %s → resurfaced=%s', (_label, rowId, resurfaced) => {
    store.archive(CHAT, ref(50), 1_000);
    expect(store.receiveInbound(CHAT, ref(rowId), 2_000)).toEqual({ resurfaced });
    expect(store.getConversation(CHAT)?.state.kind).toBe(resurfaced ? 'inbox' : 'archived');
  });

  it('the same inbound event replayed twice resurfaces only once', () => {
    store.archive(CHAT, ref(50), 1_000);
    expect(store.receiveInbound(CHAT, ref(51), 2_000)).toEqual({ resurfaced: true });
    expect(store.receiveInbound(CHAT, ref(51), 2_001)).toEqual({ resurfaced: false });
  });

  it('an inbound after the snooze watermark wakes the conversation early', () => {
    store.snooze(CHAT, ref(50), 999_999, 1_000);
    expect(store.receiveInbound(CHAT, ref(51), 2_000)).toEqual({ resurfaced: true });
  });

  it('a verified outbound restores archived and snoozed conversations', () => {
    store.archive(CHAT, ref(50), 1_000);
    store.snooze(OTHER, ref(60), 999_999, 1_000);
    expect(store.verifyOutbound(CHAT, ref(70), 2_000)).toEqual({ resurfaced: true });
    expect(store.verifyOutbound(OTHER, ref(71), 2_000)).toEqual({ resurfaced: true });
    expect(store.getConversation(CHAT)?.state).toEqual({ kind: 'inbox' });
    expect(store.getConversation(OTHER)?.state).toEqual({ kind: 'inbox' });
  });

  it('source events for conversations rx never touched are no-ops', () => {
    expect(store.receiveInbound(CHAT, ref(1), 1_000)).toEqual({ resurfaced: false });
    expect(store.verifyOutbound(CHAT, ref(1), 1_000)).toEqual({ resurfaced: false });
    expect(store.getConversation(CHAT)).toBeNull();
  });

  // Clock boundary: snoozed_until <= now wakes, one millisecond earlier holds.
  it.each([
    ['one ms before the deadline', 4_999, []],
    ['exactly at the deadline', 5_000, [CHAT]],
    ['after the deadline', 6_000, [CHAT]],
  ])('wakeDue %s → %j', (_label, now, woken) => {
    store.snooze(CHAT, ref(50), 5_000, 1_000);
    expect(store.wakeDue(now)).toEqual(woken);
    expect(store.getConversation(CHAT)?.state.kind).toBe(woken.length > 0 ? 'inbox' : 'snoozed');
  });

  it('wakeDue wakes only due snoozes and is idempotent', () => {
    store.snooze(CHAT, ref(50), 5_000, 1_000);
    store.snooze(OTHER, ref(60), 9_000, 1_000);
    expect(store.wakeDue(5_000)).toEqual([CHAT]);
    expect(store.wakeDue(5_000)).toEqual([]);
    expect(store.getConversation(OTHER)?.state.kind).toBe('snoozed');
  });
});

describe('seen watermark', () => {
  it('markSeen creates an inbox row for an untouched conversation', () => {
    store.markSeen(CHAT, ref(10), 1_000);
    expect(store.getConversation(CHAT)).toMatchObject({
      state: { kind: 'inbox' },
      seenThrough: { guid: 'G-10', rowId: 10 },
    });
  });

  it('markSeen only moves forward — replaying an older watermark is a no-op', () => {
    store.markSeen(CHAT, ref(10), 1_000);
    store.markSeen(CHAT, ref(8), 2_000);
    expect(store.getConversation(CHAT)?.seenThrough).toEqual({ guid: 'G-10', rowId: 10 });
    store.markSeen(CHAT, ref(12), 3_000);
    expect(store.getConversation(CHAT)?.seenThrough).toEqual({ guid: 'G-12', rowId: 12 });
  });

  it('seen watermark survives archive and resurface', () => {
    store.markSeen(CHAT, ref(10), 1_000);
    store.archive(CHAT, ref(10), 2_000);
    store.receiveInbound(CHAT, ref(11), 3_000);
    expect(store.getConversation(CHAT)?.seenThrough).toEqual({ guid: 'G-10', rowId: 10 });
  });

  it('markUnseen clears the watermark and leaves triage state alone', () => {
    store.markSeen(CHAT, ref(10), 1_000);
    store.archive(CHAT, ref(10), 2_000);
    store.markUnseen(CHAT, 3_000);
    expect(store.getConversation(CHAT)).toMatchObject({
      state: { kind: 'archived' },
      seenThrough: null,
      updatedAt: 3_000,
    });
  });

  it('markUnseen on a missing or already-cleared row is a no-op', () => {
    store.markUnseen(CHAT, 1_000);
    expect(store.getConversation(CHAT)).toBeNull();
    store.markSeen(CHAT, ref(10), 2_000);
    store.markUnseen(CHAT, 3_000);
    store.markUnseen(CHAT, 4_000);
    expect(store.getConversation(CHAT)?.seenThrough).toBeNull();
  });

  it('markSeen after markUnseen advances the watermark again', () => {
    store.markSeen(CHAT, ref(10), 1_000);
    store.markUnseen(CHAT, 2_000);
    store.markSeen(CHAT, ref(10), 3_000);
    expect(store.getConversation(CHAT)?.seenThrough).toEqual({ guid: 'G-10', rowId: 10 });
  });
});

describe('spaces', () => {
  it('creates spaces in order and rejects duplicate names', () => {
    expect(store.createSpace('Family', 1_000)).toEqual({
      ok: { id: 1, name: 'Family', position: 0 },
    });
    expect(store.createSpace('Work', 1_000)).toEqual({ ok: { id: 2, name: 'Work', position: 1 } });
    expect(store.createSpace('Family', 1_000)).toEqual({ err: 'duplicate-space-name' });
  });

  it('renames with duplicate and missing-id outcomes', () => {
    store.createSpace('Family', 1_000);
    store.createSpace('Work', 1_000);
    expect(store.renameSpace(2, 'Clients', 2_000)).toEqual({
      ok: { id: 2, name: 'Clients', position: 1 },
    });
    expect(store.renameSpace(2, 'Family', 2_000)).toEqual({ err: 'duplicate-space-name' });
    expect(store.renameSpace(99, 'X', 2_000)).toEqual({ err: 'space-not-found' });
  });

  it('reorders and keeps positions compact', () => {
    store.createSpace('A', 1_000);
    store.createSpace('B', 1_000);
    store.createSpace('C', 1_000);
    const result = store.reorderSpace(3, 0, 2_000);
    expect(result).toEqual({
      ok: [
        { id: 3, name: 'C', position: 0 },
        { id: 1, name: 'A', position: 1 },
        { id: 2, name: 'B', position: 2 },
      ],
    });
    expect(store.reorderSpace(99, 0, 2_000)).toEqual({ err: 'space-not-found' });
  });

  it('assigns, reassigns, and unassigns conversations', () => {
    store.createSpace('Family', 1_000);
    store.createSpace('Work', 1_000);
    expect(store.assignSpace(CHAT, 1)).toEqual({ ok: null });
    expect(store.assignSpace(CHAT, 2)).toEqual({ ok: null });
    expect(store.listAssignments()).toEqual([{ chatGuid: CHAT, spaceId: 2 }]);
    expect(store.assignSpace(CHAT, null)).toEqual({ ok: null });
    expect(store.listAssignments()).toEqual([]);
    expect(store.assignSpace(CHAT, 99)).toEqual({ err: 'space-not-found' });
  });

  it('space moves and deletes never touch workflow state', () => {
    store.createSpace('Family', 1_000);
    store.archive(CHAT, ref(50), 1_000);
    store.assignSpace(CHAT, 1);
    expect(store.deleteSpace(1)).toEqual({ ok: null });
    expect(store.listAssignments()).toEqual([]);
    expect(store.getConversation(CHAT)?.state).toEqual({
      kind: 'archived',
      inboundWatermark: 50,
    });
    expect(store.deleteSpace(1)).toEqual({ err: 'space-not-found' });
    expect(store.listSpaces()).toEqual([]);
  });
});

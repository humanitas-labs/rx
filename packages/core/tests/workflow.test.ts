import { describe, expect, it } from 'vitest';

import { archive, reconcile, restore, snooze } from '@/workflow';

const quiet = { latestInbound: null, verifiedOutbound: false, now: 1_000 };

describe('archive semantics (spec §3.2)', () => {
  it('stays archived while nothing newer arrives', () => {
    const state = archive(50);
    expect(reconcile(state, { ...quiet, latestInbound: 50 })).toBe(state);
  });

  it('resurfaces on a later inbound message', () => {
    expect(reconcile(archive(50), { ...quiet, latestInbound: 51 })).toEqual({ kind: 'inbox' });
  });

  it('resurfaces on a verified outbound send', () => {
    expect(reconcile(archive(50), { ...quiet, verifiedOutbound: true })).toEqual({
      kind: 'inbox',
    });
  });
});

describe('snooze semantics (spec §3.3)', () => {
  it('stays snoozed before the wake time', () => {
    const state = snooze(2_000, 50);
    expect(reconcile(state, { ...quiet, now: 1_999 })).toBe(state);
  });

  it('wakes at the deadline', () => {
    expect(reconcile(snooze(2_000, 50), { ...quiet, now: 2_000 })).toEqual({ kind: 'inbox' });
  });

  it('resurfaces early on a later inbound message', () => {
    expect(reconcile(snooze(2_000, 50), { ...quiet, latestInbound: 51 })).toEqual({
      kind: 'inbox',
    });
  });

  it('re-snoozing replaces the prior wake time', () => {
    expect(snooze(3_000, 50)).toEqual({ kind: 'snoozed', wakeAt: 3_000, inboundWatermark: 50 });
  });
});

describe('inbox and restore', () => {
  it('inbox is stable under any activity', () => {
    const state = restore();
    expect(reconcile(state, { latestInbound: 99, verifiedOutbound: true, now: 9_999 })).toBe(
      state,
    );
  });

  it('a conversation with no known inbound archives at watermark 0', () => {
    expect(archive(null)).toEqual({ kind: 'archived', inboundWatermark: 0 });
  });
});

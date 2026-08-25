// Thread assembly (step 9): separators, sender runs, tapback netting,
// reply snippets, and announcements — pure logic over typed items.

import type { MessageItemView } from '@rx/contract';
import { describe, expect, it } from 'vitest';

import {
  assembleThread,
  separatorLabel,
  type ThreadNode,
} from '../../src/renderer/src/features/thread/assemble';

// Fixed local reference: Wed 2026-08-26 12:00.
const NOW = new Date(2026, 7, 26, 12, 0, 0).getTime();
const T0 = new Date(2026, 7, 26, 9, 0, 0).getTime();

function text(
  guid: string,
  atMs: number,
  overrides: Partial<{
    text: string;
    isFromMe: boolean;
    senderHandle: string | null;
    replyToGuid: string | null;
    attachments: [];
  }> = {},
): MessageItemView {
  return {
    kind: 'text',
    base: {
      guid,
      rowId: 0,
      isFromMe: overrides.isFromMe ?? false,
      senderHandle: overrides.senderHandle ?? '+15550000001',
      sentAtMs: atMs,
    },
    text: overrides.text ?? `message ${guid}`,
    spans: [],
    editedAtMs: null,
    hasAttachments: false,
    attachments: [],
    replyToGuid: overrides.replyToGuid ?? null,
  };
}

function tapback(
  guid: string,
  atMs: number,
  target: string,
  type: number,
  overrides: Partial<{ emoji: string | null; isFromMe: boolean; senderHandle: string }> = {},
): MessageItemView {
  return {
    kind: 'tapback',
    base: {
      guid,
      rowId: 0,
      isFromMe: overrides.isFromMe ?? false,
      senderHandle: overrides.senderHandle ?? '+15550000001',
      sentAtMs: atMs,
    },
    tapbackType: type,
    added: type < 3000,
    targetMessageGuid: target,
    emoji: overrides.emoji ?? null,
  };
}

function messages(nodes: ThreadNode[]) {
  return nodes.filter((n): n is Extract<ThreadNode, { kind: 'message' }> => n.kind === 'message');
}

describe('assembleThread', () => {
  it('inserts a separator first and after an hour of silence', () => {
    const nodes = assembleThread(
      [text('A', T0), text('B', T0 + 30_000), text('C', T0 + 2 * 3_600_000)],
      { isGroup: false, now: NOW },
    );
    expect(nodes.map((n) => n.kind)).toEqual([
      'separator',
      'message',
      'message',
      'separator',
      'message',
    ]);
  });

  it('groups same-sender runs within a minute and marks group starts', () => {
    const nodes = assembleThread(
      [
        text('A', T0),
        text('B', T0 + 10_000),
        text('C', T0 + 20_000, { isFromMe: true, senderHandle: null }),
        text('D', T0 + 120_000),
      ],
      { isGroup: true, now: NOW },
    );
    const m = messages(nodes);
    expect(m.map((n) => n.groupStart)).toEqual([true, false, true, true]);
    expect(m.map((n) => n.showSender)).toEqual([true, false, false, true]);
  });

  it('nets tapbacks onto target bubbles, removals cancelling adds', () => {
    const nodes = assembleThread(
      [
        text('A', T0),
        text('B', T0 + 1_000, { isFromMe: true, senderHandle: null }),
        tapback('T1', T0 + 2_000, 'A', 2001),
        tapback('T2', T0 + 3_000, 'A', 3001), // removal nets to zero
        tapback('T3', T0 + 4_000, 'B', 2000),
        tapback('T4', T0 + 5_000, 'B', 2006, { emoji: '🔥', senderHandle: 'x@example.com' }),
      ],
      { isGroup: true, now: NOW },
    );
    const m = messages(nodes);
    expect(m[0]?.tapbacks).toEqual([]);
    expect(m[1]?.tapbacks.map((t) => t.glyph)).toEqual(['❤️', '🔥']);
  });

  it('resolves reply snippets from loaded messages, with a fallback', () => {
    const nodes = assembleThread(
      [
        text('A', T0, { text: 'the root line\nsecond line' }),
        text('B', T0 + 1_000, { replyToGuid: 'A' }),
        text('C', T0 + 2_000, { replyToGuid: 'not-loaded' }),
      ],
      { isGroup: false, now: NOW },
    );
    const m = messages(nodes);
    expect(m[0]?.replySnippet).toBeNull();
    expect(m[1]?.replySnippet).toBe('the root line');
    expect(m[2]?.replySnippet).toBe('Earlier message');
  });

  it('formats group announcements', () => {
    const rename: MessageItemView = {
      kind: 'group-event',
      base: { guid: 'E1', rowId: 0, isFromMe: false, senderHandle: 'x@example.com', sentAtMs: T0 },
      itemType: 2,
      groupTitle: 'New Name',
    };
    const left: MessageItemView = {
      kind: 'group-event',
      base: { guid: 'E2', rowId: 0, isFromMe: true, senderHandle: null, sentAtMs: T0 + 1_000 },
      itemType: 3,
      groupTitle: null,
    };
    const nodes = assembleThread([rename, left], { isGroup: true, now: NOW });
    const events = nodes.filter((n) => n.kind === 'event');
    expect(events.map((n) => n.kind === 'event' && n.text)).toEqual([
      'x@example.com named the conversation “New Name”',
      'You left the conversation',
    ]);
  });

  it('labels separators relative to now', () => {
    expect(separatorLabel(T0, NOW).startsWith('Today ')).toBe(true);
    expect(separatorLabel(T0 - 86_400_000, NOW).startsWith('Yesterday ')).toBe(true);
    expect(separatorLabel(T0 - 3 * 86_400_000, NOW).startsWith('Sunday ')).toBe(true);
    expect(separatorLabel(T0 - 30 * 86_400_000, NOW)).toMatch(/Jul/);
  });
});

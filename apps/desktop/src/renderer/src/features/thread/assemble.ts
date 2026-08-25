// Pure thread assembly (plan step 9): turns a page of typed message items
// into display nodes — time separators, sender grouping, tapbacks netted
// onto their target bubbles, reply snippets, and group announcements.
// No DOM, no clock reads; fully unit-testable.

import type { MessageItemView } from '@rx/contract';

export type BubbleItem = Extract<MessageItemView, { kind: 'text' | 'unsupported' }>;

export interface TapbackBadge {
  glyph: string;
  fromMe: boolean;
}

export type ThreadNode =
  | { kind: 'separator'; key: string; label: string }
  | { kind: 'event'; key: string; text: string }
  | {
      kind: 'message';
      key: string;
      item: BubbleItem;
      tapbacks: TapbackBadge[];
      /** Snippet of the replied-to message; null when not a reply. */
      replySnippet: string | null;
      /** Show the sender label above the bubble (groups, first of a run). */
      showSender: boolean;
      /** First bubble of a sender run — takes the larger top gap. */
      groupStart: boolean;
    };

/** A separator appears before the first item and after an hour of silence. */
const SEPARATOR_GAP_MS = 3_600_000;
/** Consecutive same-sender messages within a minute render as one run. */
const RUN_GAP_MS = 60_000;
const SNIPPET_LIMIT = 80;

const TAPBACK_GLYPHS: Record<number, string> = {
  2000: '❤️',
  2001: '👍',
  2002: '👎',
  2003: '😂',
  2004: '‼️',
  2005: '❓',
};

export function assembleThread(
  items: readonly MessageItemView[],
  options: { isGroup: boolean; now: number },
): ThreadNode[] {
  // Net tapbacks per (target, sender, kind): a removal cancels the matching
  // add. Targets outside the loaded page drop silently.
  const tapbacksByTarget = new Map<string, Map<string, TapbackBadge>>();
  for (const item of items) {
    if (item.kind !== 'tapback' || item.targetMessageGuid === null) {
      continue;
    }
    const normalizedType = item.tapbackType >= 3000 ? item.tapbackType - 1000 : item.tapbackType;
    const glyph = item.emoji ?? TAPBACK_GLYPHS[normalizedType] ?? null;
    if (glyph === null) {
      continue; // stickers and unknown reaction types
    }
    const sender = item.base.isFromMe ? 'me' : (item.base.senderHandle ?? '?');
    const netKey = `${sender}|${normalizedType}|${item.emoji ?? ''}`;
    const forTarget = tapbacksByTarget.get(item.targetMessageGuid) ?? new Map();
    if (item.added) {
      forTarget.set(netKey, { glyph, fromMe: item.base.isFromMe });
    } else {
      forTarget.delete(netKey);
    }
    tapbacksByTarget.set(item.targetMessageGuid, forTarget);
  }

  const snippets = new Map<string, string>();
  for (const item of items) {
    if (item.kind === 'text') {
      snippets.set(item.base.guid, snippetOf(item));
    }
  }

  const nodes: ThreadNode[] = [];
  let previous: { sentAtMs: number; senderKey: string } | null = null;
  for (const item of items) {
    if (item.kind === 'tapback') {
      continue;
    }
    const at = item.base.sentAtMs;
    if (previous === null || at - previous.sentAtMs >= SEPARATOR_GAP_MS) {
      nodes.push({
        kind: 'separator',
        key: `sep-${item.base.guid}`,
        label: separatorLabel(at, options.now),
      });
      previous = null;
    }
    if (item.kind === 'group-event') {
      nodes.push({ kind: 'event', key: item.base.guid, text: announcementText(item) });
      previous = null;
      continue;
    }
    const senderKey = item.base.isFromMe ? 'me' : (item.base.senderHandle ?? '?');
    const groupStart =
      previous === null || previous.senderKey !== senderKey || at - previous.sentAtMs > RUN_GAP_MS;
    nodes.push({
      kind: 'message',
      key: item.base.guid,
      item,
      tapbacks: [...(tapbacksByTarget.get(item.base.guid)?.values() ?? [])],
      replySnippet:
        item.kind === 'text' && item.replyToGuid !== null
          ? (snippets.get(item.replyToGuid) ?? 'Earlier message')
          : null,
      showSender: options.isGroup && !item.base.isFromMe && groupStart,
      groupStart,
    });
    previous = { sentAtMs: at, senderKey };
  }
  return nodes;
}

function snippetOf(item: Extract<MessageItemView, { kind: 'text' }>): string {
  const firstLine = (item.text.split('\n')[0] ?? '').trim();
  if (firstLine.length === 0) {
    return item.attachments.length > 0 ? 'Attachment' : 'Message';
  }
  return firstLine.length > SNIPPET_LIMIT ? `${firstLine.slice(0, SNIPPET_LIMIT)}…` : firstLine;
}

function announcementText(item: Extract<MessageItemView, { kind: 'group-event' }>): string {
  const who = item.base.isFromMe ? 'You' : (item.base.senderHandle ?? 'Someone');
  switch (item.itemType) {
    case 2:
      return item.groupTitle !== null
        ? `${who} named the conversation “${item.groupTitle}”`
        : `${who} removed the conversation name`;
    case 3:
      return `${who} left the conversation`;
    default:
      return `${who} changed the members`;
  }
}

export function separatorLabel(ms: number, now: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(at)) / 86_400_000);
  if (dayDiff === 0) {
    return `Today ${time}`;
  }
  if (dayDiff === 1) {
    return `Yesterday ${time}`;
  }
  if (dayDiff < 7) {
    return `${at.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`;
  }
  return `${at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${time}`;
}

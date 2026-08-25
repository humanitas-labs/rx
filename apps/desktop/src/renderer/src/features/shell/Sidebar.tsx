// Sidebar per frame 48-2191: view tabs, filter, conversation list, Space
// button. Rows show the designed anatomy (avatar, name, sub-line, time,
// unread dot, active bar); the visual polish pass lands with step 8.

import type { RefObject } from 'react';

import type { ConversationView, ListView } from '@rx/contract';

const VIEWS: { key: ListView; label: string; shortcut: string }[] = [
  { key: 'inbox', label: 'Inbox', shortcut: '1' },
  { key: 'snoozed', label: 'Snoozed', shortcut: '2' },
  { key: 'archived', label: 'Archive', shortcut: '3' },
];

export function Sidebar(props: {
  view: ListView;
  loading: boolean;
  listError: string | null;
  conversations: ConversationView[];
  selectedGuid: string | null;
  onSelect: (guid: string) => void;
  onSelectView: (view: ListView) => void;
  filterQuery: string;
  filterActive: boolean;
  filterRef: RefObject<HTMLInputElement | null>;
  onFilterChange: (query: string) => void;
  onFilterFocus: () => void;
  onFilterCommit: () => void;
  onOpenSpaces: () => void;
  spaceLabel: string;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top" />
      <div className="tab-row" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={props.view === v.key}
            className={`tab${props.view === v.key ? ' active' : ''}`}
            title={`${v.label} (${v.shortcut})`}
            onClick={() => props.onSelectView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {props.filterActive && (
        <input
          ref={props.filterRef}
          className="filter-field"
          placeholder="Filter"
          value={props.filterQuery}
          onChange={(e) => props.onFilterChange(e.target.value)}
          onFocus={props.onFilterFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              props.onFilterCommit();
            }
          }}
        />
      )}
      <div className="conv-list" role="listbox" aria-label="Conversations" tabIndex={-1}>
        {props.loading ? (
          <div className="placeholder">Loading…</div>
        ) : props.listError === 'source' ? (
          <div className="placeholder">
            Messages access is unavailable.
            <br />
            Check permissions in onboarding.
          </div>
        ) : props.listError !== null ? (
          <div className="placeholder">Could not load conversations.</div>
        ) : props.conversations.length === 0 ? (
          <div className="placeholder">{emptyLabel(props.view, props.filterQuery)}</div>
        ) : (
          props.conversations.map((c) => (
            <ConversationRow
              key={c.chatGuid}
              conversation={c}
              view={props.view}
              selected={c.chatGuid === props.selectedGuid}
              onSelect={() => props.onSelect(c.chatGuid)}
            />
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <button className="space-button" onClick={props.onOpenSpaces} title="Spaces (g s)">
          <span className="space-glyph">⬡</span>
          <span>{props.spaceLabel}</span>
        </button>
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation: c,
  view,
  selected,
  onSelect,
}: {
  conversation: ConversationView;
  view: ListView;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = c.displayName ?? c.participantHandles.join(', ');
  const time =
    view === 'snoozed' && c.state.kind === 'snoozed'
      ? `⏰ ${formatTime(c.state.wakeAt)}`
      : formatTime(c.lastActivityAtMs);
  return (
    <button
      role="option"
      aria-selected={selected}
      className={`conv-row${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      {c.unread && <span className="unread-dot" />}
      <span className="avatar">{initials(name)}</span>
      <span className="conv-main">
        <span className="conv-name">{name || 'Unknown'}</span>
        <span className="conv-sub">
          {c.isGroup ? `${c.participantHandles.length} people` : (c.participantHandles[0] ?? '')}
        </span>
      </span>
      <span className="conv-time">{time}</span>
    </button>
  );
}

function emptyLabel(view: ListView, filter: string): string {
  if (filter.length > 0) {
    return 'No conversations match.';
  }
  switch (view) {
    case 'inbox':
      return 'Inbox zero.';
    case 'snoozed':
      return 'Nothing snoozed.';
    case 'archived':
      return 'Nothing archived.';
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => (p[0] ?? '').toUpperCase());
  return chars.join('') || '?';
}

/** `11:10` today, `Yesterday`, weekday within a week, else a short date. */
function formatTime(ms: number): string {
  const then = new Date(ms);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff <= 0) {
    return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 1) {
    return 'Yesterday';
  }
  if (dayDiff < 7) {
    return then.toLocaleDateString([], { weekday: 'long' });
  }
  return then.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

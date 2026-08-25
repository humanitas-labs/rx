// Sidebar per frame 48-2191: view tabs, filter, virtualized conversation
// list, Space button. Rows carry the designed anatomy — 40 px avatar, name,
// one-line preview, relative time, unread dot, active bar. Triage is
// keyboard / palette / context menu (iss-0006 retires the hover glyphs).

import { useEffect, useRef, useState, type RefObject } from 'react';

import type { ConversationView, ListView } from '@rx/contract';

import archiveIcon from '@/assets/archive.svg';
import clockDashedIcon from '@/assets/clock-dashed.svg';
import composeIcon from '@/assets/compose.svg';
import filterIcon from '@/assets/filter.svg';
import hexagonIcon from '@/assets/hexagon.svg';
import inboxIcon from '@/assets/inbox.svg';
import { computeWindow, scrollTopFor } from '@/features/conversations/virtual';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';

export const ROW_HEIGHT = 64;

const VIEWS: { key: ListView; label: string; shortcut: string; icon: string }[] = [
  { key: 'inbox', label: 'Inbox', shortcut: '1', icon: inboxIcon },
  { key: 'snoozed', label: 'Snoozed', shortcut: '2', icon: clockDashedIcon },
  { key: 'archived', label: 'Archive', shortcut: '3', icon: archiveIcon },
];

export function Sidebar(props: {
  view: ListView;
  loading: boolean;
  listError: string | null;
  conversations: ConversationView[];
  selectedGuid: string | null;
  onSelect: (guid: string) => void;
  onSelectView: (view: ListView) => void;
  onRowContextMenu: (guid: string, x: number, y: number) => void;
  filterQuery: string;
  filterActive: boolean;
  searching: boolean;
  filterRef: RefObject<HTMLInputElement | null>;
  onFilterChange: (query: string) => void;
  onFilterFocus: () => void;
  onFilterCommit: () => void;
  onOpenSpaces: () => void;
  onCompose: () => void;
  spaceLabel: string;
  /** Source monitoring is degraded; the list may be stale (plan step 11). */
  monitorDegraded: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    const el = listRef.current;
    if (el === null) {
      return;
    }
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight));
    observer.observe(el);
    setViewportH(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Keep the keyboard selection visible (spec §4.1 focus preservation).
  useEffect(() => {
    const el = listRef.current;
    if (el === null || props.selectedGuid === null) {
      return;
    }
    const index = props.conversations.findIndex((c) => c.chatGuid === props.selectedGuid);
    if (index === -1) {
      return;
    }
    const target = scrollTopFor(index, el.scrollTop, el.clientHeight, ROW_HEIGHT);
    if (target !== null) {
      el.scrollTop = target;
    }
  }, [props.selectedGuid, props.conversations]);

  const win = computeWindow(scrollTop, viewportH, ROW_HEIGHT, props.conversations.length);
  const slice = props.conversations.slice(win.start, win.end);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="compose-button" title="New conversation" onClick={props.onCompose}>
          <Icon src={composeIcon} width={15} height={15} />
        </button>
      </div>
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
            <Icon src={v.icon} width={13} height={13} />
          </button>
        ))}
        <span className="tab-spacer" />
        <button className="filter-toggle" title="Filter (/)" onClick={props.onFilterFocus}>
          <Icon src={filterIcon} width={14} height={8} />
        </button>
      </div>
      {props.filterActive && (
        <input
          ref={props.filterRef}
          className="filter-field"
          placeholder="Search name, handle, or message"
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
      {props.monitorDegraded && (
        <div className="monitor-banner">Live updates interrupted — retrying…</div>
      )}
      <div
        ref={listRef}
        className="conv-list"
        role="listbox"
        aria-label="Conversations"
        tabIndex={-1}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
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
          <div className="placeholder">
            {props.searching ? 'Searching…' : emptyLabel(props.view, props.filterQuery)}
          </div>
        ) : (
          <>
            <div style={{ height: win.topPad }} />
            {slice.map((c) => (
              <ConversationRow
                key={c.chatGuid}
                conversation={c}
                view={props.view}
                selected={c.chatGuid === props.selectedGuid}
                onSelect={() => props.onSelect(c.chatGuid)}
                onContextMenu={(x, y) => props.onRowContextMenu(c.chatGuid, x, y)}
              />
            ))}
            <div style={{ height: win.bottomPad }} />
          </>
        )}
      </div>
      <div className="sidebar-bottom">
        <button
          className="space-button"
          onClick={props.onOpenSpaces}
          title={`Spaces — ${props.spaceLabel} (g s)`}
        >
          <span className="space-glyph">
            <Icon src={hexagonIcon} width={14} height={13} />
          </span>
          {props.spaceLabel !== 'All' && (
            <span className="space-button-label">{props.spaceLabel}</span>
          )}
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
  onContextMenu,
}: {
  conversation: ConversationView;
  view: ListView;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const name = c.displayName ?? c.participantHandles.join(', ');
  const time =
    view === 'snoozed' && c.state.kind === 'snoozed'
      ? `⏰ ${formatTime(c.state.wakeAt)}`
      : formatTime(c.lastActivityAtMs);
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`conv-row${selected ? ' selected' : ''}`}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      {c.unread && <span className="unread-dot" />}
      <Avatar name={name} handles={c.isGroup ? [] : c.participantHandles} />
      <span className="conv-main">
        <span className="conv-name">{name || 'Unknown'}</span>
        <span className="conv-sub">
          {c.previewText ??
            (c.isGroup ? `${c.participantHandles.length} people` : (c.participantHandles[0] ?? ''))}
        </span>
      </span>
      <span className="conv-time">{time}</span>
    </div>
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

/** `11:10` today, `Yesterday`, weekday within a week, else a short date. */
function formatTime(ms: number): string {
  const then = new Date(ms);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff < 0) {
    // Future (snooze wake times): day plus clock time.
    return then.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 0) {
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

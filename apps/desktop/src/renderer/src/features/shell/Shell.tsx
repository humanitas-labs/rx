// The application shell (plan step 7, extended in step 8): one mode state
// machine, one command dispatcher, one window-level key listener feeding the
// pure keyboard core (docs/spec/keyboard.md §6). Feature components render
// state and invoke commands; none install their own shortcut handlers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ConversationView, ListView, SpaceScope, SpaceView } from '@rx/contract';

import { NewConversation } from '@/features/compose/NewConversation';
import { ContextMenu, type MenuItem } from '@/features/conversations/ContextMenu';
import { MoveToSpace } from '@/features/conversations/MoveToSpace';
import { SnoozePicker } from '@/features/conversations/SnoozePicker';
import { CommandPalette } from '@/features/shell/CommandPalette';
import { Reader } from '@/features/shell/Reader';
import { Sidebar, type RowAction } from '@/features/shell/Sidebar';
import { SpaceSwitcher } from '@/features/shell/SpaceSwitcher';
import {
  CHORD_WINDOW_MS,
  resolveKey,
  type CommandDeclaration,
  type Mode,
} from '@/keyboard/core';

type OverlayKind = 'none' | 'palette' | 'spaces' | 'snooze' | 'move' | 'compose';

/** How long a search keystroke settles before the source query runs. */
const SEARCH_DEBOUNCE_MS = 150;

export function Shell() {
  const [mode, setMode] = useState<Mode>('navigation');
  const [view, setView] = useState<ListView>('inbox');
  const [space, setSpace] = useState<SpaceScope>('all');
  const [spaces, setSpaces] = useState<SpaceView[]>([]);
  const [conversations, setConversations] = useState<ConversationView[] | null>(null);
  const [searchResults, setSearchResults] = useState<ConversationView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [overlay, setOverlay] = useState<OverlayKind>('none');
  const [overlayTarget, setOverlayTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ guid: string; x: number; y: number } | null>(null);
  const [chordPending, setChordPending] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const prevMode = useRef<Mode>('navigation');
  const chordTimer = useRef<number | null>(null);
  const draftsRef = useRef(new Map<string, string>());
  const selectionMemory = useRef(new Map<string, string>());
  const selectedIndexRef = useRef(0);
  const searchGeneration = useRef(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const query = filterQuery.trim();

  // ---- data loading -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void window.rx
      .invoke('conversations.list', { view, space, limit: 500 })
      .then((response) => {
        if (!cancelled) {
          setConversations(response.conversations);
          setListError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConversations([]);
          setListError(String(error).includes('source-unavailable') ? 'source' : 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, space, refreshTick]);

  useEffect(() => {
    void window.rx.invoke('spaces.list', {}).then((r) => setSpaces(r.spaces));
  }, [refreshTick]);

  // Source-side search: names, handles, plain and decoded message text.
  // Debounced; a generation counter cancels anything stale (spec §4.2).
  useEffect(() => {
    if (query.length === 0) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const generation = ++searchGeneration.current;
    const timer = window.setTimeout(() => {
      void window.rx
        .invoke('conversations.search', { query, space, limit: 100 })
        .then((response) => {
          if (generation === searchGeneration.current) {
            setSearchResults(response.conversations.filter((c) => c.state.kind === view));
            setSearching(false);
          }
        })
        .catch(() => {
          if (generation === searchGeneration.current) {
            setSearchResults([]);
            setSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, space, view, refreshTick]);

  const visible = useMemo(() => {
    if (query.length > 0) {
      return searchResults ?? [];
    }
    return conversations ?? [];
  }, [query, searchResults, conversations]);

  // Selection memory per (Space, view) plus nearest-row fallback, so triage
  // that removes the selected row lands the selection on its neighbor
  // (spec §4.1, plan step 8 focus preservation).
  const memoryKey = `${String(space)}|${view}`;
  useEffect(() => {
    if (conversations === null) {
      return;
    }
    const index = visible.findIndex((c) => c.chatGuid === selectedGuid);
    if (selectedGuid !== null && index !== -1) {
      selectionMemory.current.set(memoryKey, selectedGuid);
      selectedIndexRef.current = index;
      return;
    }
    const remembered = selectionMemory.current.get(memoryKey);
    const nearest = visible[Math.min(selectedIndexRef.current, visible.length - 1)];
    const fallback =
      remembered !== undefined && visible.some((c) => c.chatGuid === remembered)
        ? remembered
        : (nearest?.chatGuid ?? visible[0]?.chatGuid ?? null);
    setSelectedGuid(fallback);
  }, [conversations, visible, selectedGuid, memoryKey]);

  // ---- mode helpers -------------------------------------------------------

  const openOverlay = useCallback(
    (kind: Exclude<OverlayKind, 'none'>, target: string | null = null) => {
      prevMode.current = mode === 'overlay' ? prevMode.current : mode;
      setOverlay(kind);
      setOverlayTarget(target);
      setMode('overlay');
    },
    [mode],
  );

  const closeOverlay = useCallback(() => {
    setOverlay('none');
    setOverlayTarget(null);
    setMode(prevMode.current);
  }, []);

  useEffect(() => {
    if (mode === 'insert') {
      composerRef.current?.focus();
    } else if (mode === 'filter') {
      filterRef.current?.focus();
      filterRef.current?.select();
    } else if (mode === 'navigation') {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [mode]);

  // ---- commands -----------------------------------------------------------

  const moveSelection = useCallback(
    (delta: number) => {
      if (visible.length === 0) {
        return;
      }
      const index = visible.findIndex((c) => c.chatGuid === selectedGuid);
      const next = index === -1 ? 0 : Math.max(0, Math.min(visible.length - 1, index + delta));
      const guid = visible[next]?.chatGuid;
      if (guid !== undefined) {
        setSelectedGuid(guid);
      }
    },
    [visible, selectedGuid],
  );

  const selectSpace = useCallback((next: SpaceScope) => {
    setSpace(next);
  }, []);

  const triage = useCallback(
    (action: 'archive' | 'restore' | { snoozeUntil: number }, guid?: string) => {
      const chatGuid = guid ?? selectedGuid;
      if (chatGuid === null) {
        return;
      }
      const call =
        action === 'archive'
          ? window.rx.invoke('workflow.archive', { chatGuid })
          : action === 'restore'
            ? window.rx.invoke('workflow.restore', { chatGuid })
            : window.rx.invoke('workflow.snooze', { chatGuid, wakeAt: action.snoozeUntil });
      // No optimistic disappearance: the row leaves only after the rx write
      // committed (spec/v0.md §4.5).
      void call.then(refresh);
    },
    [selectedGuid, refresh],
  );

  const assign = useCallback(
    (chatGuid: string, spaceId: number | null) => {
      void window.rx.invoke('spaces.assign', { chatGuid, spaceId }).then(refresh);
    },
    [refresh],
  );

  const runCommand = useCallback(
    (id: string) => {
      switch (id) {
        case 'list.next':
          return moveSelection(1);
        case 'list.previous':
          return moveSelection(-1);
        case 'mode.insert':
          if (selectedGuid !== null) {
            setMode('insert');
          }
          return;
        case 'mode.filter':
          setMode('filter');
          return;
        case 'mode.exitInsert':
        case 'mode.exitFilter':
          setMode('navigation');
          return;
        case 'nav.escape':
          if (filterQuery.length > 0) {
            setFilterQuery('');
          }
          return;
        case 'view.inbox':
          return setView('inbox');
        case 'view.snoozed':
          return setView('snoozed');
        case 'view.archive':
          return setView('archived');
        case 'space.all':
          return selectSpace('all');
        case 'space.unassigned':
          return selectSpace('unassigned');
        case 'space.switcher':
          return openOverlay('spaces');
        case 'palette.open':
          return openOverlay('palette');
        case 'conv.archive':
          return triage('archive');
        case 'conv.restore':
          return triage('restore');
        case 'conv.snooze':
          if (selectedGuid !== null) {
            openOverlay('snooze', selectedGuid);
          }
          return;
        case 'conv.snoozeHour':
          return triage({ snoozeUntil: Date.now() + 3_600_000 });
        case 'conv.snoozeTomorrow':
          return triage({ snoozeUntil: nextMorning() });
        case 'conv.moveToSpace':
          if (selectedGuid !== null) {
            openOverlay('move', selectedGuid);
          }
          return;
        case 'conv.openInMessages':
          if (selectedGuid !== null) {
            void window.rx.invoke('conversation.openInMessages', { chatGuid: selectedGuid });
          }
          return;
        case 'composer.send':
          sendRef.current?.();
          return;
        case 'compose.new':
          return openOverlay('compose');
        default:
          if (id.startsWith('space.number.')) {
            const slot = Number(id.slice('space.number.'.length)) - 2;
            const target = spaces[slot];
            if (target !== undefined) {
              selectSpace(target.id);
            }
          }
      }
    },
    [moveSelection, selectedGuid, filterQuery, selectSpace, openOverlay, triage, spaces],
  );

  // The palette registry: same command ids, with labels, shortcuts, and
  // enablement (keyboard spec §6). Disabled commands stay visible.
  const registry = useMemo<CommandDeclaration[]>(() => {
    const hasSelection = selectedGuid !== null;
    const inTriageableView = view === 'snoozed' || view === 'archived';
    const entry = (
      id: string,
      label: string,
      shortcut: string | undefined,
      disabledReason: string | null = null,
    ): CommandDeclaration => ({
      id,
      label,
      ...(shortcut === undefined ? {} : { shortcut }),
      modes: ['navigation', 'insert', 'filter'],
      disabledReason,
      run: () => runCommand(id),
    });
    return [
      entry('view.inbox', 'Go to Inbox', '1'),
      entry('view.snoozed', 'Go to Snoozed', '2'),
      entry('view.archive', 'Go to Archive', '3'),
      entry('space.all', 'Go to Space: All', '⌘1'),
      ...spaces.map((s, i) =>
        entry(`space.number.${i + 2}`, `Go to Space: ${s.name}`, i < 8 ? `⌘${i + 2}` : undefined),
      ),
      entry('space.unassigned', 'Go to Space: Unassigned', undefined),
      entry('space.switcher', 'Open Space switcher', 'g s'),
      entry('mode.filter', 'Filter conversations', '/'),
      entry(
        'conv.archive',
        'Archive conversation',
        undefined,
        hasSelection ? null : 'no conversation selected',
      ),
      entry('conv.snooze', 'Snooze…', undefined, hasSelection ? null : 'no conversation selected'),
      entry(
        'conv.snoozeHour',
        'Snooze for 1 hour',
        undefined,
        hasSelection ? null : 'no conversation selected',
      ),
      entry(
        'conv.snoozeTomorrow',
        'Snooze until tomorrow 9:00',
        undefined,
        hasSelection ? null : 'no conversation selected',
      ),
      entry(
        'conv.restore',
        'Restore to Inbox',
        undefined,
        hasSelection && inTriageableView ? null : 'nothing to restore here',
      ),
      entry(
        'conv.moveToSpace',
        'Move to Space…',
        undefined,
        hasSelection ? null : 'no conversation selected',
      ),
      entry(
        'conv.openInMessages',
        'Open in Messages',
        undefined,
        hasSelection ? null : 'no conversation selected',
      ),
      entry(
        'composer.send',
        'Send message',
        '⌘↩',
        hasSelection ? null : 'no conversation selected',
      ),
      entry('compose.new', 'New conversation', undefined),
    ];
  }, [selectedGuid, view, spaces, runCommand]);

  // ---- row/menu affordances ----------------------------------------------

  const onRowAction = useCallback(
    (guid: string, action: RowAction) => {
      if (action === 'snooze') {
        openOverlay('snooze', guid);
      } else {
        triage(action, guid);
      }
    },
    [openOverlay, triage],
  );

  const menuItemsFor = useCallback(
    (guid: string): MenuItem[] => {
      const conversation = visible.find((c) => c.chatGuid === guid) ?? null;
      const state = conversation?.state.kind ?? 'inbox';
      const items: MenuItem[] = [];
      if (state === 'inbox') {
        items.push({ label: 'Archive', run: () => triage('archive', guid) });
      } else {
        items.push({ label: 'Restore to Inbox', run: () => triage('restore', guid) });
      }
      items.push({ label: 'Snooze…', run: () => openOverlay('snooze', guid) });
      items.push({
        label: 'Open in Messages',
        run: () => void window.rx.invoke('conversation.openInMessages', { chatGuid: guid }),
      });
      items.push({
        label: 'Move to Space…',
        separator: true,
        run: () => openOverlay('move', guid),
      });
      for (const s of spaces) {
        items.push({
          label: s.name,
          checked: conversation?.spaceId === s.id,
          run: () => assign(guid, s.id),
        });
      }
      items.push({
        label: 'Unassigned',
        checked: conversation !== null && conversation.spaceId === null,
        run: () => assign(guid, null),
      });
      return items;
    },
    [visible, spaces, triage, openOverlay, assign],
  );

  // ---- window key handling ------------------------------------------------

  const stateRef = useRef({ mode, chordPending });
  stateRef.current = { mode, chordPending };
  const runRef = useRef(runCommand);
  runRef.current = runCommand;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const action = resolveKey(stateRef.current, {
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        isComposing: event.isComposing,
        inEditable,
      });
      const clearChord = () => {
        if (chordTimer.current !== null) {
          window.clearTimeout(chordTimer.current);
          chordTimer.current = null;
        }
        setChordPending(false);
      };
      if (action.type === 'chord-start') {
        event.preventDefault();
        clearChord();
        setChordPending(true);
        chordTimer.current = window.setTimeout(() => setChordPending(false), CHORD_WINDOW_MS);
        return;
      }
      if (stateRef.current.chordPending) {
        clearChord();
      }
      if (action.type === 'command') {
        event.preventDefault();
        runRef.current(action.id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Chord state resets on window blur or overlay open (keyboard spec §6).
  useEffect(() => {
    const reset = () => setChordPending(false);
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, []);
  useEffect(() => {
    if (overlay !== 'none') {
      setChordPending(false);
    }
  }, [overlay]);

  // ---- render -------------------------------------------------------------

  const selected = visible.find((c) => c.chatGuid === selectedGuid) ?? null;
  const overlayConversation =
    overlayTarget === null ? selected : (visible.find((c) => c.chatGuid === overlayTarget) ?? null);
  const overlayName =
    overlayConversation === null
      ? ''
      : (overlayConversation.displayName ?? overlayConversation.participantHandles.join(', '));

  return (
    <div className="shell">
      <Sidebar
        view={view}
        loading={conversations === null}
        listError={listError}
        conversations={visible}
        selectedGuid={selectedGuid}
        onSelect={(guid) => setSelectedGuid(guid)}
        onSelectView={(v) => setView(v)}
        onRowAction={onRowAction}
        onRowContextMenu={(guid, x, y) => setMenu({ guid, x, y })}
        filterQuery={filterQuery}
        filterActive={mode === 'filter' || filterQuery.length > 0}
        searching={searching}
        filterRef={filterRef}
        onFilterChange={setFilterQuery}
        onFilterFocus={() => setMode('filter')}
        onFilterCommit={() => setMode('navigation')}
        onOpenSpaces={() => openOverlay('spaces')}
        onCompose={() => openOverlay('compose')}
        spaceLabel={spaceLabel(space, spaces)}
      />
      <Reader
        conversation={selected}
        composerRef={composerRef}
        draftsRef={draftsRef}
        onComposerFocus={() => setMode('insert')}
        onHeaderMenu={(x, y) => {
          if (selectedGuid !== null) {
            setMenu({ guid: selectedGuid, x, y });
          }
        }}
        onSeen={(guid) =>
          setConversations(
            (rows) =>
              rows?.map((row) => (row.chatGuid === guid ? { ...row, unread: false } : row)) ?? null,
          )
        }
        onSent={refresh}
        sendRef={sendRef}
      />
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.guid)}
          onClose={() => setMenu(null)}
        />
      )}
      {overlay === 'spaces' && (
        <SpaceSwitcher
          spaces={spaces}
          active={space}
          onSelect={(scope) => {
            selectSpace(scope);
            closeOverlay();
          }}
          onChanged={() => refresh()}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'snooze' && overlayTarget !== null && (
        <SnoozePicker
          conversationName={overlayName}
          onSnooze={(wakeAt) => {
            const guid = overlayTarget;
            closeOverlay();
            triage({ snoozeUntil: wakeAt }, guid);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'move' && overlayTarget !== null && (
        <MoveToSpace
          conversationName={overlayName}
          spaces={spaces}
          currentSpaceId={overlayConversation?.spaceId ?? null}
          onAssign={(spaceId) => {
            const guid = overlayTarget;
            closeOverlay();
            assign(guid, spaceId);
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'compose' && (
        <NewConversation
          onDelivered={(chatGuid) => {
            closeOverlay();
            setView('inbox');
            setSelectedGuid(chatGuid);
            refresh();
          }}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'palette' && (
        <CommandPalette
          registry={registry}
          mode={prevMode.current}
          onExecute={(cmd) => {
            closeOverlay();
            cmd.run();
          }}
          onClose={closeOverlay}
        />
      )}
    </div>
  );
}

function spaceLabel(space: SpaceScope, spaces: SpaceView[]): string {
  if (space === 'all') {
    return 'All';
  }
  if (space === 'unassigned') {
    return 'Unassigned';
  }
  return spaces.find((s) => s.id === space)?.name ?? 'All';
}

function nextMorning(): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

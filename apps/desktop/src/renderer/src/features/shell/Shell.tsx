// The application shell (plan step 7): one mode state machine, one command
// dispatcher, one window-level key listener feeding the pure keyboard core
// (docs/spec/keyboard.md §6). Feature components render state and invoke
// commands; none install their own shortcut handlers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ConversationView, ListView, SpaceScope, SpaceView } from '@rx/contract';

import { CommandPalette } from '@/features/shell/CommandPalette';
import { Reader } from '@/features/shell/Reader';
import { Sidebar } from '@/features/shell/Sidebar';
import { SpaceSwitcher } from '@/features/shell/SpaceSwitcher';
import {
  CHORD_WINDOW_MS,
  resolveKey,
  type CommandDeclaration,
  type Mode,
} from '@/keyboard/core';

type OverlayKind = 'none' | 'palette' | 'spaces';

export interface ShellSnapshot {
  mode: Mode;
  view: ListView;
  space: SpaceScope;
  spaces: SpaceView[];
  visible: ConversationView[];
  selectedGuid: string | null;
  filterQuery: string;
  overlay: OverlayKind;
}

export function Shell() {
  const [mode, setMode] = useState<Mode>('navigation');
  const [view, setView] = useState<ListView>('inbox');
  const [space, setSpace] = useState<SpaceScope>('all');
  const [spaces, setSpaces] = useState<SpaceView[]>([]);
  const [conversations, setConversations] = useState<ConversationView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [overlay, setOverlay] = useState<OverlayKind>('none');
  const [chordPending, setChordPending] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const prevMode = useRef<Mode>('navigation');
  const chordTimer = useRef<number | null>(null);
  const draftsRef = useRef(new Map<string, string>());
  const selectionMemory = useRef(new Map<string, string>());
  const filterRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // ---- data loading -------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void window.rx
      .invoke('conversations.list', { view, space, limit: 100 })
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

  const visible = useMemo(() => {
    if (conversations === null) {
      return [];
    }
    const q = filterQuery.trim().toLowerCase();
    if (q.length === 0) {
      return conversations;
    }
    return conversations.filter(
      (c) =>
        (c.displayName ?? '').toLowerCase().includes(q) ||
        c.participantHandles.some((h) => h.toLowerCase().includes(q)),
    );
  }, [conversations, filterQuery]);

  // Selection memory per (Space, view); nearest-row fallback (spec §4.1).
  const memoryKey = `${String(space)}|${view}`;
  useEffect(() => {
    if (conversations === null) {
      return;
    }
    if (selectedGuid !== null && visible.some((c) => c.chatGuid === selectedGuid)) {
      selectionMemory.current.set(memoryKey, selectedGuid);
      return;
    }
    const remembered = selectionMemory.current.get(memoryKey);
    const fallback =
      remembered !== undefined && visible.some((c) => c.chatGuid === remembered)
        ? remembered
        : (visible[0]?.chatGuid ?? null);
    setSelectedGuid(fallback);
  }, [conversations, visible, selectedGuid, memoryKey]);

  // ---- mode helpers -------------------------------------------------------

  const openOverlay = useCallback(
    (kind: Exclude<OverlayKind, 'none'>) => {
      prevMode.current = mode === 'overlay' ? prevMode.current : mode;
      setOverlay(kind);
      setMode('overlay');
    },
    [mode],
  );

  const closeOverlay = useCallback(() => {
    setOverlay('none');
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
    (action: 'archive' | 'restore' | { snoozeUntil: number }) => {
      if (selectedGuid === null) {
        return;
      }
      const call =
        action === 'archive'
          ? window.rx.invoke('workflow.archive', { chatGuid: selectedGuid })
          : action === 'restore'
            ? window.rx.invoke('workflow.restore', { chatGuid: selectedGuid })
            : window.rx.invoke('workflow.snooze', {
                chatGuid: selectedGuid,
                wakeAt: action.snoozeUntil,
              });
      // No optimistic disappearance: the row leaves only after the rx write
      // committed (spec/v0.md §4.5).
      void call.then(refresh);
    },
    [selectedGuid, refresh],
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
        case 'conv.snoozeHour':
          return triage({ snoozeUntil: Date.now() + 3_600_000 });
        case 'conv.snoozeTomorrow':
          return triage({ snoozeUntil: nextMorning() });
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
      entry('composer.send', 'Send message', '⌘↩', 'sending arrives with delivery verification'),
      entry('compose.new', 'New conversation', undefined, 'new conversations arrive in a later step'),
    ];
  }, [selectedGuid, view, spaces, runCommand]);

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
        filterQuery={filterQuery}
        filterActive={mode === 'filter' || filterQuery.length > 0}
        filterRef={filterRef}
        onFilterChange={setFilterQuery}
        onFilterFocus={() => setMode('filter')}
        onFilterCommit={() => setMode('navigation')}
        onOpenSpaces={() => openOverlay('spaces')}
        spaceLabel={spaceLabel(space, spaces)}
      />
      <Reader
        conversation={selected}
        composerRef={composerRef}
        draftsRef={draftsRef}
        onComposerFocus={() => setMode('insert')}
        onSeen={(guid) =>
          setConversations(
            (rows) =>
              rows?.map((row) => (row.chatGuid === guid ? { ...row, unread: false } : row)) ?? null,
          )
        }
      />
      {overlay === 'spaces' && (
        <SpaceSwitcher
          spaces={spaces}
          active={space}
          onSelect={(scope) => {
            selectSpace(scope);
            closeOverlay();
          }}
          onCreated={() => refresh()}
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

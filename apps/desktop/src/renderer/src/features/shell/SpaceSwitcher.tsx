// Space switcher overlay per frame 48-2301: dim scrim, bottom-up stack —
// All, user Spaces (⌘2…⌘9), Unassigned (inventory Q3), New Space with an
// inline name field. Rename/reorder/delete land with step 8.

import { useEffect, useRef, useState } from 'react';

import type { SpaceScope, SpaceView } from '@rx/contract';

export function SpaceSwitcher(props: {
  spaces: SpaceView[];
  active: SpaceScope;
  onSelect: (scope: SpaceScope) => void;
  onCreated: () => void;
  onClose: () => void;
}) {
  type Entry = { scope: SpaceScope; label: string; hint: string | null };
  const entries: Entry[] = [
    { scope: 'all', label: 'All', hint: '⌘1' },
    ...props.spaces.map((s, i) => ({
      scope: s.id as SpaceScope,
      label: s.name,
      hint: i < 8 ? `⌘${i + 2}` : null,
    })),
    { scope: 'unassigned', label: 'Unassigned', hint: null },
  ];

  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.scope === props.active),
    ),
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (creating) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setCreating(false);
        setCreateError(null);
      }
      return;
    }
    event.stopPropagation();
    if (event.key === 'Escape') {
      props.onClose();
    } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      setCursor((c) => Math.min(entries.length - 1, c + 1));
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      const entry = entries[cursor];
      if (entry !== undefined) {
        props.onSelect(entry.scope);
      }
    }
  }

  function create() {
    const name = newName.trim();
    if (name.length === 0) {
      return;
    }
    void window.rx.invoke('spaces.create', { name }).then((outcome) => {
      if ('err' in outcome) {
        setCreateError(
          outcome.err === 'duplicate-space-name' ? 'A Space with that name exists.' : outcome.err,
        );
      } else {
        setNewName('');
        setCreating(false);
        setCreateError(null);
        props.onCreated();
      }
    });
  }

  return (
    <div className="scrim" onClick={props.onClose}>
      <div
        ref={panelRef}
        role="listbox"
        aria-label="Spaces"
        tabIndex={-1}
        className="overlay-panel space-stack"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {entries.map((entry, index) => (
          <button
            key={String(entry.scope)}
            role="option"
            aria-selected={entry.scope === props.active}
            className={`overlay-row${index === cursor ? ' selected' : ''}`}
            onMouseEnter={() => setCursor(index)}
            onClick={() => props.onSelect(entry.scope)}
          >
            <span>{entry.label}</span>
            {entry.hint !== null && <span className="hint">{entry.hint}</span>}
          </button>
        ))}
        {creating ? (
          <div style={{ padding: '6px 10px' }}>
            <input
              autoFocus
              placeholder="Space name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  create();
                }
              }}
              style={{ width: '100%', padding: '5px 8px' }}
            />
            {createError !== null && (
              <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{createError}</div>
            )}
          </div>
        ) : (
          <button className="overlay-row" onClick={() => setCreating(true)}>
            <span>＋ New Space</span>
          </button>
        )}
      </div>
    </div>
  );
}

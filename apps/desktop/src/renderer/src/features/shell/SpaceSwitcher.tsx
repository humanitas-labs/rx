// Space switcher overlay per frame 48-2301: dim scrim, bottom-up stack —
// All, user Spaces (⌘2…⌘9), Unassigned (inventory Q3), New Space with an
// inline name field. Step 8 adds management on user-Space rows: rename
// (inline), reorder (up/down), delete (inline confirm; members return to
// Unassigned, workflow state untouched — spec §3.6).

import { useEffect, useRef, useState } from 'react';

import type { SpaceScope, SpaceView } from '@rx/contract';

export function SpaceSwitcher(props: {
  spaces: SpaceView[];
  active: SpaceScope;
  onSelect: (scope: SpaceScope) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  type Entry = { scope: SpaceScope; label: string; hint: string | null; space: SpaceView | null };
  const entries: Entry[] = [
    { scope: 'all', label: 'All', hint: '⌘1', space: null },
    ...props.spaces.map((s, i) => ({
      scope: s.id as SpaceScope,
      label: s.name,
      hint: i < 8 ? `⌘${i + 2}` : null,
      space: s,
    })),
    { scope: 'unassigned', label: 'Unassigned', hint: null, space: null },
  ];

  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.scope === props.active),
    ),
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editing = creating || renaming !== null;

  useEffect(() => {
    if (!editing) {
      panelRef.current?.focus();
    }
  }, [editing]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (editing) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setCreating(false);
        setRenaming(null);
        setError(null);
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

  function fail(err: string) {
    setError(err === 'duplicate-space-name' ? 'A Space with that name exists.' : err);
  }

  function create() {
    const name = newName.trim();
    if (name.length === 0) {
      return;
    }
    void window.rx.invoke('spaces.create', { name }).then((outcome) => {
      if ('err' in outcome) {
        fail(outcome.err);
      } else {
        setNewName('');
        setCreating(false);
        setError(null);
        props.onChanged();
      }
    });
  }

  function commitRename(space: SpaceView) {
    const name = renameValue.trim();
    if (name.length === 0 || name === space.name) {
      setRenaming(null);
      setError(null);
      return;
    }
    void window.rx.invoke('spaces.rename', { id: space.id, name }).then((outcome) => {
      if ('err' in outcome) {
        fail(outcome.err);
      } else {
        setRenaming(null);
        setError(null);
        props.onChanged();
      }
    });
  }

  function reorder(space: SpaceView, delta: number) {
    const index = props.spaces.findIndex((s) => s.id === space.id);
    const position = index + delta;
    if (position < 0 || position >= props.spaces.length) {
      return;
    }
    void window.rx.invoke('spaces.reorder', { id: space.id, position }).then(() => {
      props.onChanged();
    });
  }

  function remove(space: SpaceView) {
    void window.rx.invoke('spaces.delete', { id: space.id }).then(() => {
      setConfirmingDelete(null);
      props.onChanged();
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
        {entries.map((entry, index) =>
          entry.space !== null && renaming === entry.space.id ? (
            <div key={String(entry.scope)} className="space-edit">
              <input
                autoFocus
                aria-label="Rename Space"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && entry.space !== null) {
                    e.stopPropagation();
                    commitRename(entry.space);
                  }
                }}
              />
            </div>
          ) : entry.space !== null && confirmingDelete === entry.space.id ? (
            <div key={String(entry.scope)} className="space-edit confirm">
              <span>Delete “{entry.label}”? Members return to Unassigned.</span>
              <span className="space-confirm-actions">
                <button className="btn danger" onClick={() => entry.space && remove(entry.space)}>
                  Delete
                </button>
                <button className="btn" onClick={() => setConfirmingDelete(null)}>
                  Keep
                </button>
              </span>
            </div>
          ) : (
            <div
              key={String(entry.scope)}
              className={`overlay-row space-row${index === cursor ? ' selected' : ''}${
                entry.scope === props.active ? ' active' : ''
              }`}
              role="option"
              aria-selected={entry.scope === props.active}
              onMouseEnter={() => setCursor(index)}
              onClick={() => props.onSelect(entry.scope)}
            >
              <span className="space-row-label">{entry.label}</span>
              {entry.space !== null && (
                <span className="space-tools" onClick={(e) => e.stopPropagation()}>
                  <button
                    title="Move up"
                    aria-label={`Move ${entry.label} up`}
                    onClick={() => entry.space && reorder(entry.space, -1)}
                  >
                    ↑
                  </button>
                  <button
                    title="Move down"
                    aria-label={`Move ${entry.label} down`}
                    onClick={() => entry.space && reorder(entry.space, 1)}
                  >
                    ↓
                  </button>
                  <button
                    title="Rename"
                    aria-label={`Rename ${entry.label}`}
                    onClick={() => {
                      if (entry.space !== null) {
                        setRenaming(entry.space.id);
                        setRenameValue(entry.space.name);
                        setError(null);
                      }
                    }}
                  >
                    ✎
                  </button>
                  <button
                    title="Delete"
                    aria-label={`Delete ${entry.label}`}
                    onClick={() => entry.space && setConfirmingDelete(entry.space.id)}
                  >
                    ×
                  </button>
                </span>
              )}
              {entry.hint !== null && <span className="hint">{entry.hint}</span>}
            </div>
          ),
        )}
        {creating ? (
          <div className="space-edit">
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
            />
          </div>
        ) : (
          <button className="overlay-row" onClick={() => setCreating(true)}>
            <span>＋ New Space</span>
          </button>
        )}
        {error !== null && <div className="overlay-error">{error}</div>}
      </div>
    </div>
  );
}

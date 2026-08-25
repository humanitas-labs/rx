// Command palette (keyboard spec §4.5): every command visible, disabled ones
// with a reason; overlay controls per §3.4.

import { useEffect, useMemo, useRef, useState } from 'react';

import { paletteEntries, type CommandDeclaration, type Mode } from '@/keyboard/core';

export function CommandPalette(props: {
  registry: CommandDeclaration[];
  /** The mode the palette opened from — drives enablement display. */
  mode: Mode;
  onExecute: (command: CommandDeclaration) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () => paletteEntries(props.registry, props.mode, query),
    [props.registry, props.mode, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      props.onClose();
    } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      setCursor((c) => Math.min(entries.length - 1, c + 1));
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      const entry = entries[cursor];
      if (entry !== undefined && entry.disabledReason === null) {
        props.onExecute(entry);
      }
    }
  }

  return (
    <div className="scrim center" onClick={props.onClose}>
      <div
        className="overlay-panel palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="palette-list" role="listbox">
          {entries.length === 0 ? (
            <div className="placeholder" style={{ padding: 16 }}>
              No matching commands.
            </div>
          ) : (
            entries.map((entry, index) => (
              <button
                key={entry.id}
                role="option"
                aria-selected={index === cursor}
                aria-disabled={entry.disabledReason !== null}
                className={`overlay-row${index === cursor ? ' selected' : ''}${entry.disabledReason !== null ? ' disabled' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => {
                  if (entry.disabledReason === null) {
                    props.onExecute(entry);
                  }
                }}
              >
                <span>{entry.label}</span>
                <span className="hint">
                  {entry.disabledReason ?? entry.shortcut ?? ''}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

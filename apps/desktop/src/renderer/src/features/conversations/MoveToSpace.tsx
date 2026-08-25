// Move-to-Space overlay (plan step 8): the keyboard path for Space
// assignment — palette → “Move to Space…” → this list. The pointer path is
// the row context menu; both call spaces.assign.

import { useEffect, useRef, useState } from 'react';

import type { SpaceView } from '@rx/contract';

export function MoveToSpace(props: {
  conversationName: string;
  spaces: SpaceView[];
  currentSpaceId: number | null;
  onAssign: (spaceId: number | null) => void;
  onClose: () => void;
}) {
  type Entry = { spaceId: number | null; label: string };
  const entries: Entry[] = [
    ...props.spaces.map((s) => ({ spaceId: s.id as number | null, label: s.name })),
    { spaceId: null, label: 'Unassigned' },
  ];
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.spaceId === props.currentSpaceId),
    ),
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
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
        props.onAssign(entry.spaceId);
      }
    }
  }

  return (
    <div className="scrim center" onClick={props.onClose}>
      <div
        ref={panelRef}
        role="listbox"
        aria-label="Move to Space"
        tabIndex={-1}
        className="overlay-panel snooze-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="overlay-title">Move “{props.conversationName}” to…</div>
        {entries.map((entry, index) => (
          <button
            key={entry.spaceId ?? 'unassigned'}
            role="option"
            aria-selected={entry.spaceId === props.currentSpaceId}
            className={`overlay-row${index === cursor ? ' selected' : ''}`}
            onMouseEnter={() => setCursor(index)}
            onClick={() => props.onAssign(entry.spaceId)}
          >
            <span>{entry.label}</span>
            {entry.spaceId === props.currentSpaceId && <span className="hint">current</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

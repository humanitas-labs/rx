// Snooze picker overlay (plan step 8, inventory §1.4): quick choices plus a
// custom local date-time. Traps its own keys like every overlay (keyboard
// spec §3.4); Escape returns to the previous mode without snoozing.

import { useEffect, useRef, useState } from 'react';

import { parseCustomWake, snoozePresets, toDatetimeLocal } from '@/features/conversations/snooze';

export function SnoozePicker(props: {
  conversationName: string;
  onSnooze: (wakeAt: number) => void;
  onClose: () => void;
}) {
  const presets = useRef(snoozePresets(new Date())).current;
  const [cursor, setCursor] = useState(0);
  const [custom, setCustom] = useState(() => toDatetimeLocal(Date.now() + 3_600_000));
  const [customError, setCustomError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const customIndex = presets.length;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function commitCustom() {
    const wakeAt = parseCustomWake(custom, new Date());
    if (wakeAt === null) {
      setCustomError(true);
      return;
    }
    props.onSnooze(wakeAt);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      props.onClose();
    } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      setCursor((c) => Math.min(customIndex, c + 1));
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === 'Enter') {
      if (cursor === customIndex) {
        commitCustom();
      } else {
        const preset = presets[cursor];
        if (preset !== undefined) {
          props.onSnooze(preset.wakeAt);
        }
      }
    }
  }

  return (
    <div className="scrim center" onClick={props.onClose}>
      <div
        ref={panelRef}
        role="listbox"
        aria-label="Snooze until"
        tabIndex={-1}
        className="overlay-panel snooze-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="overlay-title">Snooze “{props.conversationName}” until…</div>
        {presets.map((preset, index) => (
          <button
            key={preset.id}
            role="option"
            aria-selected={index === cursor}
            className={`overlay-row${index === cursor ? ' selected' : ''}`}
            onMouseEnter={() => setCursor(index)}
            onClick={() => props.onSnooze(preset.wakeAt)}
          >
            <span>{preset.label}</span>
            <span className="hint">{formatWake(preset.wakeAt)}</span>
          </button>
        ))}
        <div
          className={`overlay-row custom${cursor === customIndex ? ' selected' : ''}`}
          onMouseEnter={() => setCursor(customIndex)}
        >
          <input
            type="datetime-local"
            aria-label="Custom snooze time"
            value={custom}
            onFocus={() => setCursor(customIndex)}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                commitCustom();
              }
            }}
          />
          <button className="btn" onClick={commitCustom}>
            Snooze
          </button>
        </div>
        {customError && <div className="overlay-error">Pick a time in the future.</div>}
      </div>
    </div>
  );
}

function formatWake(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

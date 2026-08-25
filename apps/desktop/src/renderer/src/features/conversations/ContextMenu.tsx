// Conversation context menu (plan step 8, inventory §2 row 11): the pointer
// path to archive, snooze, restore, and move-to-Space. Rendered by the shell
// at the pointer position; every item routes through the same commands the
// keyboard uses.

import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  disabled?: boolean;
  /** Render a hairline above this item. */
  separator?: boolean;
  checked?: boolean;
  run: () => void;
}

export function ContextMenu(props: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
    // Keep the menu inside the window.
    const el = menuRef.current;
    if (el !== null) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) {
        el.style.top = `${Math.max(0, window.innerHeight - rect.height - 8)}px`;
      }
      if (rect.right > window.innerWidth) {
        el.style.left = `${Math.max(0, window.innerWidth - rect.width - 8)}px`;
      }
    }
  }, []);

  return (
    <div className="menu-scrim" onClick={props.onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        className="context-menu"
        style={{ left: props.x, top: props.y }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            props.onClose();
          }
        }}
      >
        {props.items.map((item, index) => (
          <button
            key={index}
            role="menuitem"
            className={`menu-item${item.separator ? ' separated' : ''}`}
            disabled={item.disabled ?? false}
            onClick={() => {
              props.onClose();
              item.run();
            }}
          >
            <span className="menu-check">{item.checked ? '✓' : ''}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

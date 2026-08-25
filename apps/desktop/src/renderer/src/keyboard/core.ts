// The modal keyboard core (docs/spec/keyboard.md §2, §5, §6): one explicit
// mode state machine and one key-resolution function. Pure and DOM-free —
// the shell feeds it a normalized KeyInput and executes the returned action.
// Feature components never install their own document-level handlers.

export type Mode = 'navigation' | 'insert' | 'filter' | 'overlay';

/** Normalized key event. `inEditable` = an editable control has DOM focus. */
export interface KeyInput {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  isComposing: boolean;
  inEditable: boolean;
}

export type KeyAction =
  | { type: 'command'; id: string }
  | { type: 'chord-start' }
  /** Do nothing ourselves; the text field or platform handles the key. */
  | { type: 'pass' };

export interface KeyState {
  mode: Mode;
  /** True while a `g` chord window (750 ms) is open. */
  chordPending: boolean;
}

export const CHORD_WINDOW_MS = 750;

const command = (id: string): KeyAction => ({ type: 'command', id });
const pass: KeyAction = { type: 'pass' };

/**
 * Resolve one key event against the current mode, in the priority order of
 * keyboard spec §5: IME composition, overlay, global modified shortcuts,
 * text modes, Navigation commands, platform fallthrough.
 */
export function resolveKey(state: KeyState, input: KeyInput): KeyAction {
  if (input.isComposing) {
    return pass;
  }

  // Overlays trap their own keys (spec §3.4); the global resolver stays out.
  if (state.mode === 'overlay') {
    return pass;
  }

  // Global modified shortcuts work in every non-overlay mode.
  if (input.meta && !input.ctrl && !input.alt) {
    if (input.key.toLowerCase() === 'k') {
      return command('palette.open');
    }
    if (input.key === '1') {
      return command('space.all');
    }
    if (input.key >= '2' && input.key <= '9') {
      return command(`space.number.${input.key}`);
    }
    if (input.key === 'Enter' && state.mode === 'insert') {
      return command('composer.send');
    }
    return pass;
  }

  if (state.mode === 'insert' || state.mode === 'filter') {
    if (input.key === 'Escape') {
      return command(state.mode === 'insert' ? 'mode.exitInsert' : 'mode.exitFilter');
    }
    // Every printable key belongs to the text field (spec §3.2, §5).
    return pass;
  }

  // Navigation mode. A printable key must never be intercepted while an
  // editable control unexpectedly holds focus (spec §5).
  if (input.inEditable) {
    return pass;
  }

  if (state.chordPending) {
    if (input.key === 's') {
      return command('space.switcher');
    }
    // A failed chord must not swallow a valid command (spec §4.3): fall
    // through and resolve this key as if no chord were pending.
  }

  switch (input.key) {
    case 'j':
      return command('list.next');
    case 'k':
      return command('list.previous');
    case 'i':
      return command('mode.insert');
    case '/':
      return command('mode.filter');
    case '1':
      return command('view.inbox');
    case '2':
      return command('view.snoozed');
    case '3':
      return command('view.archive');
    case 'u':
      return command('conv.markUnseen');
    case 'g':
      return { type: 'chord-start' };
    case 'Escape':
      return command('nav.escape');
    default:
      return pass;
  }
}

/** Commands declared for the palette and menus (keyboard spec §6). */
export interface CommandDeclaration {
  id: string;
  label: string;
  /** macOS-notation shortcut label, e.g. "⌘K", "g s"; omit if none. */
  shortcut?: string;
  /** Modes in which the command may run. */
  modes: Mode[];
  /** Null when enabled; otherwise a short disabled reason for the palette. */
  disabledReason: string | null;
  run: () => void;
}

/** Palette entries: everything visible, disabled ones with a reason. */
export function paletteEntries(
  registry: CommandDeclaration[],
  mode: Mode,
  query: string,
): CommandDeclaration[] {
  const q = query.trim().toLowerCase();
  return registry
    .filter((cmd) => q.length === 0 || cmd.label.toLowerCase().includes(q))
    .map((cmd) => {
      if (cmd.disabledReason !== null || cmd.modes.includes(mode)) {
        return cmd;
      }
      return { ...cmd, disabledReason: 'not available here' };
    });
}

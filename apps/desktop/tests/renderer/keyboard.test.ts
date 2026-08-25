// Keyboard core tests against docs/spec/keyboard.md §5 event priority, §4.3
// chord semantics, and §3 mode maps.

import { describe, expect, it } from 'vitest';

import {
  paletteEntries,
  resolveKey,
  type CommandDeclaration,
  type KeyInput,
  type KeyState,
} from '../../src/renderer/src/keyboard/core';

function key(partial: Partial<KeyInput>): KeyInput {
  return {
    key: '',
    meta: false,
    ctrl: false,
    alt: false,
    isComposing: false,
    inEditable: false,
    ...partial,
  };
}

const nav: KeyState = { mode: 'navigation', chordPending: false };

describe('event priority (spec §5)', () => {
  it('never fires during IME composition', () => {
    expect(resolveKey(nav, key({ key: 'j', isComposing: true }))).toEqual({ type: 'pass' });
    expect(resolveKey(nav, key({ key: 'k', meta: true, isComposing: true }))).toEqual({
      type: 'pass',
    });
  });

  it('leaves every key to an open overlay', () => {
    const overlay: KeyState = { mode: 'overlay', chordPending: false };
    expect(resolveKey(overlay, key({ key: 'j' }))).toEqual({ type: 'pass' });
    expect(resolveKey(overlay, key({ key: 'Escape' }))).toEqual({ type: 'pass' });
  });

  it('applies Cmd-K and Cmd-1…9 in navigation, insert, and filter modes', () => {
    for (const mode of ['navigation', 'insert', 'filter'] as const) {
      const state: KeyState = { mode, chordPending: false };
      expect(resolveKey(state, key({ key: 'k', meta: true }))).toEqual({
        type: 'command',
        id: 'palette.open',
      });
      expect(resolveKey(state, key({ key: '1', meta: true }))).toEqual({
        type: 'command',
        id: 'space.all',
      });
      expect(resolveKey(state, key({ key: '4', meta: true }))).toEqual({
        type: 'command',
        id: 'space.number.4',
      });
    }
  });

  it('sends printable keys to the text field in insert and filter modes', () => {
    for (const mode of ['insert', 'filter'] as const) {
      const state: KeyState = { mode, chordPending: false };
      expect(resolveKey(state, key({ key: 'j', inEditable: true }))).toEqual({ type: 'pass' });
      expect(resolveKey(state, key({ key: '1', inEditable: true }))).toEqual({ type: 'pass' });
      expect(resolveKey(state, key({ key: '/', inEditable: true }))).toEqual({ type: 'pass' });
    }
  });

  it('never intercepts printable keys while an editable control has focus', () => {
    expect(resolveKey(nav, key({ key: 'j', inEditable: true }))).toEqual({ type: 'pass' });
  });
});

describe('navigation mode map (spec §3.1)', () => {
  it.each([
    ['j', 'list.next'],
    ['k', 'list.previous'],
    ['i', 'mode.insert'],
    ['/', 'mode.filter'],
    ['1', 'view.inbox'],
    ['2', 'view.snoozed'],
    ['3', 'view.archive'],
    ['Escape', 'nav.escape'],
  ])('%s → %s', (k, id) => {
    expect(resolveKey(nav, key({ key: k }))).toEqual({ type: 'command', id });
  });

  it('leaves 4 unbound (spec §4.2)', () => {
    expect(resolveKey(nav, key({ key: '4' }))).toEqual({ type: 'pass' });
  });

  it('Cmd-Enter sends only from insert mode', () => {
    const insert: KeyState = { mode: 'insert', chordPending: false };
    expect(resolveKey(insert, key({ key: 'Enter', meta: true }))).toEqual({
      type: 'command',
      id: 'composer.send',
    });
    expect(resolveKey(nav, key({ key: 'Enter', meta: true }))).toEqual({ type: 'pass' });
  });
});

describe('g s chord (spec §4.3)', () => {
  it('g starts the chord and s completes it', () => {
    expect(resolveKey(nav, key({ key: 'g' }))).toEqual({ type: 'chord-start' });
    expect(resolveKey({ ...nav, chordPending: true }, key({ key: 's' }))).toEqual({
      type: 'command',
      id: 'space.switcher',
    });
  });

  it('a failed chord does not swallow the following valid command', () => {
    expect(resolveKey({ ...nav, chordPending: true }, key({ key: 'j' }))).toEqual({
      type: 'command',
      id: 'list.next',
    });
    expect(resolveKey({ ...nav, chordPending: true }, key({ key: 'g' }))).toEqual({
      type: 'chord-start',
    });
  });
});

describe('insert and filter exits (spec §3.2, §3.3)', () => {
  it('Escape exits toward navigation and preserves nothing but mode', () => {
    expect(
      resolveKey({ mode: 'insert', chordPending: false }, key({ key: 'Escape', inEditable: true })),
    ).toEqual({ type: 'command', id: 'mode.exitInsert' });
    expect(
      resolveKey({ mode: 'filter', chordPending: false }, key({ key: 'Escape', inEditable: true })),
    ).toEqual({ type: 'command', id: 'mode.exitFilter' });
  });
});

describe('palette entries (spec §4.5)', () => {
  const registry: CommandDeclaration[] = [
    {
      id: 'a',
      label: 'Archive conversation',
      modes: ['navigation'],
      disabledReason: null,
      run: () => undefined,
    },
    {
      id: 'b',
      label: 'Send message',
      modes: ['insert'],
      disabledReason: null,
      run: () => undefined,
    },
    {
      id: 'c',
      label: 'Snooze conversation',
      modes: ['navigation'],
      disabledReason: 'no conversation selected',
      run: () => undefined,
    },
  ];

  it('keeps unavailable commands visible with a reason', () => {
    const entries = paletteEntries(registry, 'navigation', '');
    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.id === 'b')?.disabledReason).toBe('not available here');
    expect(entries.find((e) => e.id === 'c')?.disabledReason).toBe('no conversation selected');
    expect(entries.find((e) => e.id === 'a')?.disabledReason).toBeNull();
  });

  it('filters by label', () => {
    expect(paletteEntries(registry, 'navigation', 'snooze').map((e) => e.id)).toEqual(['c']);
  });
});

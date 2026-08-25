import { describe, expect, it } from 'vitest';

import { computeWindow, scrollTopFor } from '../../src/renderer/src/features/conversations/virtual';

describe('computeWindow', () => {
  it('renders everything when the list fits the viewport', () => {
    const win = computeWindow(0, 600, 64, 5);
    expect(win).toEqual({ start: 0, end: 5, topPad: 0, bottomPad: 0 });
  });

  it('is empty for an empty list', () => {
    expect(computeWindow(0, 600, 64, 0)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
  });

  it('windows a long list with overscan and consistent spacer heights', () => {
    const count = 1_000;
    const win = computeWindow(6_400, 600, 64, count, 6);
    // scrolled to row 100; ~10 visible.
    expect(win.start).toBe(94);
    expect(win.end).toBe(117);
    expect(win.topPad).toBe(94 * 64);
    expect(win.bottomPad).toBe((count - win.end) * 64);
    // Total height is invariant regardless of scroll position.
    expect(win.topPad + (win.end - win.start) * 64 + win.bottomPad).toBe(count * 64);
  });

  it('clamps at the end of the list', () => {
    const win = computeWindow(999_999, 600, 64, 100);
    expect(win.end).toBe(100);
    expect(win.bottomPad).toBe(0);
  });

  it('never returns a negative start for tiny scroll offsets', () => {
    const win = computeWindow(10, 600, 64, 100, 6);
    expect(win.start).toBe(0);
    expect(win.topPad).toBe(0);
  });
});

describe('scrollTopFor', () => {
  it('returns null when the row is already fully visible', () => {
    expect(scrollTopFor(5, 0, 640, 64)).toBeNull();
  });

  it('scrolls up to reveal a row above the viewport', () => {
    expect(scrollTopFor(2, 640, 640, 64)).toBe(128);
  });

  it('scrolls down to reveal a row below the viewport', () => {
    // Row 20 ends at 1344; viewport [0, 640] → scrollTop 1344 - 640.
    expect(scrollTopFor(20, 0, 640, 64)).toBe(704);
  });
});

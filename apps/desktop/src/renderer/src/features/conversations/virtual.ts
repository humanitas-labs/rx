// Fixed-height list virtualization (plan step 8): pure window arithmetic.
// The sidebar renders only the visible slice plus overscan, with spacer
// heights standing in for everything outside it.

export interface ListWindow {
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  /** Spacer height above the rendered slice, px. */
  topPad: number;
  /** Spacer height below the rendered slice, px. */
  bottomPad: number;
}

export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 6,
): ListWindow {
  if (count === 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (count - end) * rowHeight,
  };
}

/**
 * Scroll adjustment keeping row `index` fully visible; returns the new
 * scrollTop, or null when no adjustment is needed.
 */
export function scrollTopFor(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < scrollTop) {
    return rowTop;
  }
  if (rowBottom > scrollTop + viewportHeight) {
    return rowBottom - viewportHeight;
  }
  return null;
}

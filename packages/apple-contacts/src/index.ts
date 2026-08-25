// Contacts bridge boundary (ADR-002, ADR-003 §1).
//
// The real implementation is a narrow native bridge over Apple's supported
// Contacts framework, proven under the packaged bundle identity in spike 6.
// Until then the interface ships with a fallback resolver so the application
// can build against the boundary: Messages display names and raw handles.

export interface ResolvedContact {
  /** The handle as it appears in the Apple source (phone or email). */
  handle: string;
  /** Display name when resolution succeeds; null falls back to the handle. */
  displayName: string | null;
}

export interface ContactsBridge {
  /** Resolve a bounded batch of handles. Missing entries resolve to null. */
  resolve(handles: readonly string[]): Promise<ResolvedContact[]>;
}

/**
 * Fallback bridge: resolves nothing, so callers render Messages display names
 * or raw handles. Used until the native Contacts bridge lands, and whenever
 * Contacts permission is denied.
 */
export function createFallbackBridge(): ContactsBridge {
  return {
    resolve(handles) {
      return Promise.resolve(handles.map((handle) => ({ handle, displayName: null })));
    },
  };
}

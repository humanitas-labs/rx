// Contacts bridge boundary (ADR-002, ADR-005).
//
// The real implementation reads the address book through Apple's supported
// Contacts framework via a spawned helper binary (`rx-contacts`, ADR-005) —
// no native Node module, preserving ADR-004's zero-native posture. The
// fallback resolver ships alongside it for tests and for environments where
// the helper is unavailable or Contacts permission is denied.

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

/** One address-book card as reported by the helper. Synthetic in tests. */
export interface ContactCard {
  name: string;
  phones: string[];
  emails: string[];
}

export interface ContactsSnapshot {
  /** False when the user denied the Contacts permission. */
  granted: boolean;
  contacts: ContactCard[];
}

export type ContactsLoader = () => Promise<ContactsSnapshot>;

export { createHelperLoader } from './helper';

/**
 * Fallback bridge: resolves nothing, so callers render Messages display names
 * or raw handles. Used in tests and whenever no loader is wired.
 */
export function createFallbackBridge(): ContactsBridge {
  return {
    resolve(handles) {
      return Promise.resolve(handles.map((handle) => ({ handle, displayName: null })));
    },
  };
}

export interface LoadedContactsBridge extends ContactsBridge {
  /**
   * Settles when the first snapshot load finishes (granted or not). resolve()
   * never blocks on the load — before it completes, handles resolve to null —
   * so callers can refresh their views once names become available.
   */
  ready: Promise<void>;
}

/**
 * Bridge over a snapshot loader. The snapshot is loaded once, eagerly, and
 * indexed by normalized phone digits (full and last-10) and lowercased email.
 * A failed load resolves everything to null and is retried on the next
 * resolve() call; a denied permission is remembered for the process lifetime
 * (macOS would not re-prompt anyway).
 */
export function createContactsBridge(load: ContactsLoader): LoadedContactsBridge {
  let index: Map<string, string> | null = null;
  let loading: Promise<void> | null = null;

  function startLoad(): Promise<void> {
    loading ??= load().then(
      (snapshot) => {
        index = buildIndex(snapshot);
      },
      () => {
        // Retry on the next resolve() call.
        loading = null;
      },
    );
    return loading;
  }

  const ready = startLoad();

  return {
    ready,
    resolve(handles) {
      if (index === null) {
        void startLoad();
        return Promise.resolve(handles.map((handle) => ({ handle, displayName: null })));
      }
      const idx = index;
      return Promise.resolve(
        handles.map((handle) => ({ handle, displayName: lookup(idx, handle) })),
      );
    },
  };
}

function buildIndex(snapshot: ContactsSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  if (!snapshot.granted) {
    return index;
  }
  // First card wins on key collisions, matching enumeration order.
  const claim = (key: string, name: string) => {
    if (key !== '' && !index.has(key)) {
      index.set(key, name);
    }
  };
  for (const card of snapshot.contacts) {
    for (const phone of card.phones) {
      for (const key of phoneKeys(phone)) {
        claim(key, card.name);
      }
    }
    for (const email of card.emails) {
      claim(email.trim().toLowerCase(), card.name);
    }
  }
  return index;
}

/**
 * Normalized lookup keys for one phone number: all digits, plus the last ten
 * so numbers stored with and without a country code still meet. Numbers
 * shorter than ten digits (short codes) match exactly only.
 */
function phoneKeys(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') {
    return [];
  }
  return digits.length > 10 ? [digits, digits.slice(-10)] : [digits];
}

function lookup(index: Map<string, string>, handle: string): string | null {
  if (handle.includes('@')) {
    return index.get(handle.trim().toLowerCase()) ?? null;
  }
  for (const key of phoneKeys(handle)) {
    const name = index.get(key);
    if (name !== undefined) {
      return name;
    }
  }
  return null;
}

// Production loader: spawns the `rx-contacts` helper binary (ADR-005) and
// parses its single JSON document. The first run can block on the macOS
// Contacts consent prompt, so the timeout is generous; the bridge never
// blocks callers on this (see createContactsBridge).

import { execFile } from 'node:child_process';

import type { ContactCard, ContactsLoader, ContactsSnapshot } from './index';

/** Contacts prompt can sit unanswered; give it three minutes, not thirty s. */
const HELPER_TIMEOUT_MS = 180_000;
const HELPER_MAX_BUFFER = 32 * 1024 * 1024;

export function createHelperLoader(helperPath: string): ContactsLoader {
  return () =>
    new Promise<ContactsSnapshot>((resolve, reject) => {
      execFile(
        helperPath,
        [],
        { timeout: HELPER_TIMEOUT_MS, maxBuffer: HELPER_MAX_BUFFER },
        (error, stdout) => {
          if (error !== null) {
            reject(error);
            return;
          }
          try {
            resolve(parseSnapshot(stdout));
          } catch (parseError) {
            reject(parseError instanceof Error ? parseError : new Error('contacts-parse'));
          }
        },
      );
    });
}

/** Defensive parse: a malformed document rejects rather than half-resolves. */
export function parseSnapshot(raw: string): ContactsSnapshot {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('contacts-shape');
  }
  const document = parsed as { granted?: unknown; contacts?: unknown };
  if (typeof document.granted !== 'boolean' || !Array.isArray(document.contacts)) {
    throw new Error('contacts-shape');
  }
  const contacts: ContactCard[] = document.contacts.map((entry: unknown) => {
    const card = entry as { name?: unknown; phones?: unknown; emails?: unknown; photo?: unknown };
    if (
      typeof card.name !== 'string' ||
      !Array.isArray(card.phones) ||
      !Array.isArray(card.emails)
    ) {
      throw new Error('contacts-shape');
    }
    return {
      name: card.name,
      phones: card.phones.filter((p): p is string => typeof p === 'string'),
      emails: card.emails.filter((e): e is string => typeof e === 'string'),
      ...(typeof card.photo === 'string' ? { photo: card.photo } : {}),
    };
  });
  return { granted: document.granted, contacts };
}

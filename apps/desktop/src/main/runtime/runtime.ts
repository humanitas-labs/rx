// Background lifecycle (plan step 11). Starts source observation once the
// reader is available, converts source change events into persisted
// resurface transitions *before* the renderer is notified, runs the snooze
// wake pass on launch / resume / a bounded timer, and keeps monitoring
// failures visible and retryable — a degraded observer never silently
// presents a stale inbox as current. Electron-free; index.ts supplies the
// window emit and powerMonitor hooks.

import type { EventName, EventPayload } from '@rx/contract';
import type { WorkflowStore } from '@rx/core';

import { latestRefs } from '@/apple-messages/conversations';
import {
  createSourceObserver,
  type SourceChangeEvent,
  type SourceObserver,
} from '@/apple-messages/events';
import type { MessagesReader } from '@/apple-messages/reader';

export interface RuntimeOptions {
  /** Null until capabilities pass; the runtime retries until it opens. */
  getReader: () => MessagesReader | null;
  dbPath: string;
  store: WorkflowStore;
  emit: <E extends EventName>(event: E, payload: EventPayload<E>) => void;
  now?: () => number;
  /** Observer poll fallback interval (WAL activity checks sooner). */
  pollIntervalMs?: number;
  /** Snooze wake pass interval. */
  wakeIntervalMs?: number;
  /** Retry interval for starting observation before the reader exists. */
  startRetryMs?: number;
}

export interface Runtime {
  /** Whether source observation is running (reader opened, observer live). */
  readonly observing: boolean;
  /** Run one catch-up pass now; used by tests and manual retries. */
  check(): void;
  /** Wake due snoozes now — called on launch, system resume, and the timer. */
  wakePass(): void;
  stop(): void;
}

export function startRuntime(options: RuntimeOptions): Runtime {
  const now = options.now ?? Date.now;
  const wakeIntervalMs = options.wakeIntervalMs ?? 30_000;
  const startRetryMs = options.startRetryMs ?? 3_000;

  let observer: SourceObserver | null = null;
  let startTimer: ReturnType<typeof setInterval> | null = null;
  let degraded = false;

  function reportError(error: unknown) {
    // First failure flips to degraded and tells the renderer; the observer's
    // own interval keeps retrying, so recovery needs no extra machinery.
    if (!degraded) {
      degraded = true;
      const message = error instanceof Error ? error.message : String(error);
      options.emit('source.status', { observing: false, lastError: message });
    }
  }

  function reportHealthy() {
    if (degraded) {
      degraded = false;
      options.emit('source.status', { observing: true, lastError: null });
    }
  }

  function handleEvent(event: SourceChangeEvent) {
    const reader = options.getReader();
    const at = now();
    for (const chat of event.chats) {
      if (!chat.hasInbound || reader === null) {
        continue;
      }
      // Persist the resurface before notifying, so the renderer's re-query
      // already sees the settled workflow state (plan step 11).
      const inbound = latestRefs(reader, chat.chatGuid).latestInbound;
      if (inbound !== null) {
        const outcome = options.store.receiveInbound(chat.chatGuid, inbound, at);
        if (outcome.resurfaced) {
          options.emit('workflow.changed', { chatGuid: chat.chatGuid, state: { kind: 'inbox' } });
        }
      }
    }
    reportHealthy();
    options.emit('conversations.changed', { chatGuids: event.chats.map((c) => c.chatGuid) });
  }

  function check() {
    try {
      observer?.check();
      reportHealthy();
    } catch (error) {
      reportError(error);
    }
  }

  function wakePass() {
    // While degraded, every pass also retries the source directly, so
    // recovery is reported even if no new rows ever arrive.
    if (degraded) {
      check();
    }
    const woken = options.store.wakeDue(now());
    for (const chatGuid of woken) {
      options.emit('workflow.changed', { chatGuid, state: { kind: 'inbox' } });
    }
    if (woken.length > 0) {
      options.emit('conversations.changed', { chatGuids: woken });
    }
  }

  function tryStart(): boolean {
    const reader = options.getReader();
    if (reader === null) {
      return false;
    }
    observer = createSourceObserver({
      reader,
      dbPath: options.dbPath,
      onEvent: handleEvent,
      onError: reportError,
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    });
    observer.start();
    // Launch catch-up: the initial cursor is the current MAX(ROWID) and list
    // reads always reconcile against the live source, so the first inbox is
    // settled by construction; the pass here wakes any snooze that came due
    // while rx was closed.
    wakePass();
    return true;
  }

  // The reader opens lazily (onboarding may still be granting access);
  // retry until observation starts.
  if (!tryStart()) {
    startTimer = setInterval(() => {
      if (tryStart() && startTimer !== null) {
        clearInterval(startTimer);
        startTimer = null;
      }
    }, startRetryMs);
  }

  const wakeTimer = setInterval(wakePass, wakeIntervalMs);

  return {
    get observing() {
      return observer !== null;
    },
    check,
    wakePass,
    stop() {
      observer?.stop();
      observer = null;
      if (startTimer !== null) {
        clearInterval(startTimer);
        startTimer = null;
      }
      clearInterval(wakeTimer);
    },
  };
}

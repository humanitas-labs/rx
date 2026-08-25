// Conversation reader (plan steps 9–10): latest page first with older
// paging, full thread treatments in features/thread/, seen watermark on
// open, and a composer that sends through verified delivery — the draft
// clears only after the outgoing record is confirmed in the source.

import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

import type { ConversationView, DeliveryFailureView, MessageItemView } from '@rx/contract';

import chevronIcon from '@/assets/chevron.svg';
import { FAILURE_TEXT } from '@/features/compose/compose';
import { Thread } from '@/features/thread/Thread';
import { Icon } from '@/ui/Icon';

const PAGE_SIZE = 50;

interface ThreadState {
  items: MessageItemView[];
  nextBeforeRowId: number | null;
}

export function Reader(props: {
  conversation: ConversationView | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draftsRef: MutableRefObject<Map<string, string>>;
  onComposerFocus: () => void;
  /** Open the conversation actions menu (triage, move) at this position. */
  onHeaderMenu: (x: number, y: number) => void;
  onSeen: (chatGuid: string) => void;
  /** A send was verified — workflow state may have changed (restore). */
  onSent: () => void;
  /** Shell routes ⌘↩ / the palette Send command through this. */
  sendRef: MutableRefObject<(() => void) | null>;
}) {
  const chatGuid = props.conversation?.chatGuid ?? null;
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draftTick, setDraftTick] = useState(0);
  const [sendState, setSendState] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'failed'; reason: DeliveryFailureView }
  >({ kind: 'idle' });
  // Bumps the Thread key after a verified send so it remounts scrolled to
  // the new latest message.
  const [sentTick, setSentTick] = useState(0);

  useEffect(() => {
    if (chatGuid === null) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setThread(null);
    setThreadError(false);
    setLoadingOlder(false);
    setSendState({ kind: 'idle' });
    void window.rx
      .invoke('thread.page', { chatGuid, limit: PAGE_SIZE })
      .then((page) => {
        if (!cancelled) {
          setThread(page);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThreadError(true);
        }
      });
    // Opening a conversation advances the rx seen watermark (spec §3.4).
    void window.rx.invoke('workflow.markSeen', { chatGuid }).then(() => props.onSeen(chatGuid));
    return () => {
      cancelled = true;
    };
    // Keyed by conversation identity only.
  }, [chatGuid]);

  const loadOlder = useCallback(() => {
    if (chatGuid === null || thread === null || thread.nextBeforeRowId === null || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    void window.rx
      .invoke('thread.page', {
        chatGuid,
        limit: PAGE_SIZE,
        beforeRowId: thread.nextBeforeRowId,
      })
      .then((page) => {
        setThread((current) =>
          current === null
            ? null
            : { items: [...page.items, ...current.items], nextBeforeRowId: page.nextBeforeRowId },
        );
      })
      .catch(() => {
        // Leave the loaded pages intact; scrolling up retries.
      })
      .finally(() => setLoadingOlder(false));
  }, [chatGuid, thread, loadingOlder]);

  const send = useCallback(() => {
    if (chatGuid === null || sendState.kind === 'sending') {
      return;
    }
    const text = (props.draftsRef.current.get(chatGuid) ?? '').trim();
    if (text.length === 0) {
      return;
    }
    setSendState({ kind: 'sending' });
    void window.rx
      .invoke('compose.send', { target: { kind: 'chat', chatGuid }, text })
      .then(({ outcome }) => {
        if (outcome.state !== 'verified') {
          setSendState({ kind: 'failed', reason: outcome.reason });
          return;
        }
        // Verified in the source: only now does the draft clear (§4.4).
        props.draftsRef.current.delete(chatGuid);
        setSendState({ kind: 'idle' });
        props.onSent();
        return window.rx.invoke('thread.page', { chatGuid, limit: PAGE_SIZE }).then((page) => {
          // One batched render: the thread remounts with the new message
          // already present, so the mount scroll lands on the true bottom.
          setThread(page);
          setSentTick((t) => t + 1);
        });
      })
      .catch(() => setSendState({ kind: 'failed', reason: 'automation-error' }));
  }, [chatGuid, sendState.kind]);

  useEffect(() => {
    props.sendRef.current = send;
    return () => {
      props.sendRef.current = null;
    };
  }, [send]);

  if (props.conversation === null || chatGuid === null) {
    return (
      <main className="reader">
        <div className="reader-header" style={{ height: 97 }} />
        <div className="placeholder">Select a conversation.</div>
      </main>
    );
  }

  const name = props.conversation.displayName ?? props.conversation.participantHandles.join(', ');
  const draft = props.draftsRef.current.get(chatGuid) ?? '';

  return (
    <main className="reader">
      <div className="reader-header">
        <span className="avatar">{initials(name)}</span>
        <button
          className="reader-header-name"
          title="Conversation actions"
          aria-label="Conversation actions"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            props.onHeaderMenu(rect.left, rect.bottom + 6);
          }}
        >
          <span>{name}</span>
          <Icon src={chevronIcon} width={5} height={8} color="var(--chevron)" />
        </button>
      </div>
      {threadError ? (
        <div className="placeholder">Could not load this conversation.</div>
      ) : thread === null ? (
        <div className="placeholder">Loading…</div>
      ) : thread.items.length === 0 ? (
        <div className="placeholder">No messages.</div>
      ) : (
        <Thread
          key={`${chatGuid}:${sentTick}`}
          items={thread.items}
          isGroup={props.conversation.isGroup}
          hasOlder={thread.nextBeforeRowId !== null}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
        />
      )}
      <div className="composer">
        <textarea
          ref={props.composerRef}
          placeholder="Message"
          value={draft}
          rows={1}
          readOnly={sendState.kind === 'sending'}
          onFocus={props.onComposerFocus}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline (Messages behavior).
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              if (!e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }
          }}
          onChange={(e) => {
            props.draftsRef.current.set(chatGuid, e.target.value);
            if (sendState.kind === 'failed') {
              setSendState({ kind: 'idle' });
            }
            setDraftTick(draftTick + 1);
          }}
        />
        {sendState.kind === 'sending' && <div className="composer-status">Sending…</div>}
        {sendState.kind === 'failed' && (
          <div className="composer-status failed">{FAILURE_TEXT[sendState.reason]}</div>
        )}
      </div>
    </main>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => (p[0] ?? '').toUpperCase());
  return chars.join('') || '?';
}

// Conversation reader (plan step 9): latest page first with older paging,
// full thread treatments in features/thread/, seen watermark on open,
// draft-preserving composer. Sending lands with step 10.

import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from 'react';

import type { ConversationView, MessageItemView } from '@rx/contract';

import chevronIcon from '@/assets/chevron.svg';
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
}) {
  const chatGuid = props.conversation?.chatGuid ?? null;
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draftTick, setDraftTick] = useState(0);

  useEffect(() => {
    if (chatGuid === null) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setThread(null);
    setThreadError(false);
    setLoadingOlder(false);
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
          key={chatGuid}
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
          onFocus={props.onComposerFocus}
          onChange={(e) => {
            props.draftsRef.current.set(chatGuid, e.target.value);
            setDraftTick(draftTick + 1);
          }}
        />
      </div>
    </main>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => (p[0] ?? '').toUpperCase());
  return chars.join('') || '?';
}

// Conversation reader (plan step 7 shell version): latest page, typed
// fallbacks, seen watermark on open, draft-preserving composer. Full thread
// treatments (attachments, tapback grouping, paging) land with step 9;
// sending lands with step 10.

import { useEffect, useState, type MutableRefObject, type RefObject } from 'react';

import type { ConversationView, MessageItemView } from '@rx/contract';

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
  const [items, setItems] = useState<MessageItemView[] | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [draftTick, setDraftTick] = useState(0);

  useEffect(() => {
    if (chatGuid === null) {
      setItems(null);
      return;
    }
    let cancelled = false;
    setItems(null);
    setThreadError(false);
    void window.rx
      .invoke('thread.page', { chatGuid, limit: 50 })
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
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

  if (props.conversation === null || chatGuid === null) {
    return (
      <main className="reader">
        <div className="reader-header" />
        <div className="placeholder">Select a conversation.</div>
      </main>
    );
  }

  const name = props.conversation.displayName ?? props.conversation.participantHandles.join(', ');
  const draft = props.draftsRef.current.get(chatGuid) ?? '';

  return (
    <main className="reader">
      <div className="reader-header">
        <span>{name}</span>
        <button
          className="header-menu"
          title="Conversation actions"
          aria-label="Conversation actions"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            props.onHeaderMenu(rect.left, rect.bottom + 4);
          }}
        >
          ⋯
        </button>
      </div>
      <div className="thread">
        {threadError ? (
          <div className="placeholder">Could not load this conversation.</div>
        ) : items === null ? (
          <div className="placeholder">Loading…</div>
        ) : items.length === 0 ? (
          <div className="placeholder">No messages.</div>
        ) : (
          items.map((item) => <ThreadItem key={item.base.guid} item={item} />)
        )}
      </div>
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

function ThreadItem({ item }: { item: MessageItemView }) {
  switch (item.kind) {
    case 'text':
      return (
        <div className={`bubble ${item.base.isFromMe ? 'out' : 'in'}`}>
          {item.text}
          {item.editedAtMs !== null && <span style={{ opacity: 0.6 }}> (edited)</span>}
        </div>
      );
    case 'tapback':
      return (
        <div className="thread-note">
          {item.base.isFromMe ? 'You' : (item.base.senderHandle ?? 'Someone')}{' '}
          {item.added ? 'reacted to' : 'removed a reaction from'} a message
        </div>
      );
    case 'group-event':
      return (
        <div className="thread-note">
          {item.groupTitle !== null
            ? `Group renamed to “${item.groupTitle}”`
            : 'Group membership changed'}
        </div>
      );
    case 'unsupported':
      return (
        <div className={`bubble ${item.base.isFromMe ? 'out' : 'in'}`} style={{ opacity: 0.7 }}>
          {item.reason === 'balloon-app'
            ? 'App message — open in Messages to view'
            : 'Message content unavailable'}
        </div>
      );
  }
}

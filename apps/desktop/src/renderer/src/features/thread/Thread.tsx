// Thread rendering (plan step 9): assembled nodes, older-history paging
// without scroll jumps, and attachments served over the rx-attachment
// protocol. Mounted fresh per conversation (keyed by chatGuid in Reader).

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { attachmentUrl, type AttachmentView, type MessageItemView } from '@rx/contract';

import { assembleThread, type ThreadNode } from '@/features/thread/assemble';

/** Start fetching the next older page within this many px of the top. */
const LOAD_OLDER_THRESHOLD_PX = 300;

export function Thread(props: {
  items: MessageItemView[];
  isGroup: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Height captured when an older page is requested; the layout effect
  // restores the visual position after the prepend renders.
  const anchorHeightRef = useRef<number | null>(null);
  const firstKey = props.items[0]?.base.guid ?? null;

  const nodes = useMemo(
    () => assembleThread(props.items, { isGroup: props.isGroup, now: Date.now() }),
    [props.items, props.isGroup],
  );

  // On mount, open at the latest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // After an older page is prepended, keep what was on screen on screen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== null && anchorHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - anchorHeightRef.current;
      anchorHeightRef.current = null;
    }
  }, [firstKey]);

  return (
    <div
      className="thread"
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (
          el !== null &&
          el.scrollTop < LOAD_OLDER_THRESHOLD_PX &&
          props.hasOlder &&
          !props.loadingOlder &&
          anchorHeightRef.current === null
        ) {
          anchorHeightRef.current = el.scrollHeight;
          props.onLoadOlder();
        }
      }}
    >
      {props.loadingOlder && <div className="thread-note">Loading older messages…</div>}
      {nodes.map((node) => (
        <ThreadNodeView key={node.key} node={node} />
      ))}
    </div>
  );
}

function ThreadNodeView({ node }: { node: ThreadNode }) {
  switch (node.kind) {
    case 'separator':
      return <div className="thread-date">{node.label}</div>;
    case 'event':
      return <div className="thread-note">{node.text}</div>;
    case 'message':
      return <MessageView node={node} />;
  }
}

function MessageView({ node }: { node: Extract<ThreadNode, { kind: 'message' }> }) {
  const { item } = node;
  const out = item.base.isFromMe;
  const attachments = item.attachments;
  return (
    <div className={`message ${out ? 'out' : 'in'} ${node.groupStart ? 'group-start' : ''}`}>
      {node.showSender && <div className="sender-label">{item.base.senderHandle ?? '?'}</div>}
      {node.replySnippet !== null && <div className="reply-preview">↩︎ {node.replySnippet}</div>}
      {attachments.map((attachment) => (
        <AttachmentBlock key={attachment.guid} attachment={attachment} />
      ))}
      {item.kind === 'unsupported' ? (
        attachments.length === 0 && (
          <div className={`bubble ${out ? 'out' : 'in'}`} style={{ opacity: 0.7 }}>
            {item.reason === 'balloon-app'
              ? 'App message — open in Messages to view'
              : 'Message content unavailable'}
          </div>
        )
      ) : item.text.length > 0 ? (
        <div className={`bubble ${out ? 'out' : 'in'}`}>
          {item.text}
          {item.editedAtMs !== null && <span style={{ opacity: 0.6 }}> (edited)</span>}
        </div>
      ) : null}
      {node.tapbacks.length > 0 && (
        <div className="tapbacks">{node.tapbacks.map((t) => t.glyph).join(' ')}</div>
      )}
    </div>
  );
}

function AttachmentBlock({ attachment }: { attachment: AttachmentView }) {
  // HEIC and friends fail to decode in Chromium; fall back to the chip.
  const [imageFailed, setImageFailed] = useState(false);
  const renderable =
    attachment.present && attachment.mimeType?.startsWith('image/') === true && !imageFailed;
  if (renderable) {
    return (
      <img
        className="attachment-image"
        src={attachmentUrl(attachment.guid)}
        alt={attachment.transferName ?? 'Attachment'}
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <div className="attachment-chip" title={attachment.transferName ?? undefined}>
      <span className="attachment-chip-name">{attachment.transferName ?? 'Attachment'}</span>
      <span className="attachment-chip-meta">
        {attachment.present ? formatBytes(attachment.totalBytes) : 'not downloaded'}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

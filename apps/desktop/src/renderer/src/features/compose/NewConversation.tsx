// New one-to-one conversation (plan step 10): explicit handle plus first
// message. Contacts-backed search arrives with the native Contacts bridge
// (spike 6); until then the handle is typed directly. The send is verified
// against the source before this overlay reports success.

import { useRef, useState } from 'react';

import { ComposerField } from '@/features/compose/ComposerField';
import { FAILURE_TEXT, validHandle } from '@/features/compose/compose';

export function NewConversation(props: {
  onDelivered: (chatGuid: string) => void;
  onClose: () => void;
}) {
  const [handle, setHandle] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<HTMLInputElement>(null);

  const target = validHandle(handle);
  const ready = target !== null && text.trim().length > 0 && !sending;

  function send() {
    if (!ready || target === null) {
      return;
    }
    setSending(true);
    setError(null);
    void window.rx
      .invoke('compose.send', { target: { kind: 'handle', handle: target }, text: text.trim() })
      .then(({ outcome }) => {
        if (outcome.state === 'verified') {
          props.onDelivered(outcome.chatGuid);
        } else {
          setSending(false);
          setError(FAILURE_TEXT[outcome.reason]);
        }
      })
      .catch(() => {
        setSending(false);
        setError(FAILURE_TEXT['automation-error']);
      });
  }

  return (
    <div className="scrim center" onClick={props.onClose}>
      <div
        className="overlay-panel compose-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            props.onClose();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            send();
          }
        }}
      >
        <div className="overlay-heading">
          <div className="overlay-title">New conversation</div>
        </div>
        <input
          ref={handleRef}
          className="compose-handle"
          placeholder="Phone number or email"
          value={handle}
          autoFocus
          disabled={sending}
          onChange={(e) => {
            setHandle(e.target.value);
            setError(null);
          }}
        />
        {handle.trim().length > 0 && target === null && (
          <div className="compose-hint">Enter a full phone number or email address.</div>
        )}
        <ComposerField
          className="compose-text"
          placeholder="Message"
          rows={3}
          value={text}
          readOnly={sending}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline (Messages behavior).
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              if (!e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }
          }}
        />
        {error !== null && <div className="compose-error">{error}</div>}
        <div className="compose-actions">
          <button onClick={props.onClose} disabled={sending}>
            Cancel
          </button>
          <button className="compose-send" onClick={send} disabled={!ready}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

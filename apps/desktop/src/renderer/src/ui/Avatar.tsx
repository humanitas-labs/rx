// Conversation avatar: the contact's photo when the address book has one,
// initials otherwise. The photo layers over the initials and stays invisible
// until it decodes, so a handle with no photo shows initials rather than a
// broken-image glyph — most handles have no photo.

import { avatarUrl } from '@rx/contract';
import { useEffect, useState } from 'react';

export function Avatar(props: {
  /** Name the initials are drawn from. */
  name: string;
  /**
   * Handles this conversation could show a photo for. The first with a photo
   * wins; group chats fall back to initials unless one participant resolves.
   */
  handles: readonly string[];
}): React.JSX.Element {
  const handle = props.handles[0] ?? null;
  const [state, setState] = useState<'pending' | 'loaded' | 'failed'>('pending');

  // Rows are recycled by the virtualizer: a new handle gets a fresh attempt.
  useEffect(() => setState('pending'), [handle]);

  return (
    <span className="avatar">
      {initials(props.name)}
      {handle !== null && state !== 'failed' && (
        <img
          className={`avatar-photo${state === 'loaded' ? ' loaded' : ''}`}
          src={avatarUrl(handle)}
          alt=""
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => (p[0] ?? '').toUpperCase());
  return chars.join('') || '?';
}

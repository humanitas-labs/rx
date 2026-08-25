// Conversation avatar: the contact's photo when the address book has one,
// initials otherwise. The photo layers over the initials and paints only once
// this handle's own image has decoded — so a handle with no photo shows
// initials rather than a broken glyph, and switching conversations never
// flashes the previous person's face.
//
// A failed load is deliberately not remembered: tab switches abort in-flight
// image requests, and treating that as "no photo" left avatars stuck on
// initials until the next remount.

import { avatarUrl } from '@rx/contract';
import { useState } from 'react';

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
  const [loadedHandle, setLoadedHandle] = useState<string | null>(null);

  return (
    <span className="avatar">
      {initials(props.name)}
      {handle !== null && (
        <img
          // Keyed so a new handle gets a fresh element rather than repainting
          // the old photo while the new one decodes.
          key={handle}
          className={`avatar-photo${loadedHandle === handle ? ' loaded' : ''}`}
          src={avatarUrl(handle)}
          alt=""
          onLoad={() => setLoadedHandle(handle)}
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

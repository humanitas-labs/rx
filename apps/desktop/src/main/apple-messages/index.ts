// The concrete Apple Messages source module (plan step 4). Not a generic
// provider: rx has exactly one source in v0 (spec/v0.md §5.3).

export * from '@/apple-messages/reader';
export * from '@/apple-messages/capabilities';
export * from '@/apple-messages/conversations';
export * from '@/apple-messages/messages';
export * from '@/apple-messages/attachments';
export * from '@/apple-messages/events';

import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultMessagesDatabasePath(): string {
  return join(homedir(), 'Library', 'Messages', 'chat.db');
}

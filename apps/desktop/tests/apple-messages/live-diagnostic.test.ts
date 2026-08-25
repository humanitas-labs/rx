// Live diagnostic against the real Messages database (plan step 4 exit
// criterion). Opt-in only: `RX_LIVE=1 pnpm --filter @rx/desktop test`.
// Output is statistics and latency exclusively — never message content,
// contact handles, or chat identifiers.

import { describe, expect, it } from 'vitest';

import { checkCapabilities } from '@/apple-messages/capabilities';
import { listConversationSummaries } from '@/apple-messages/conversations';
import { defaultMessagesDatabasePath } from '@/apple-messages/index';
import { openMessagesDatabase } from '@/apple-messages/reader';

const live = process.env['RX_LIVE'] === '1';

describe.skipIf(!live)('live source diagnostic', () => {
  it('lists 100 conversation summaries without exposing content', () => {
    const dbPath = defaultMessagesDatabasePath();
    const caps = checkCapabilities(dbPath);
    expect(caps.database).toBe('ok');
    expect(caps.missingTables).toEqual([]);

    const reader = openMessagesDatabase(dbPath);
    try {
      const startedAt = performance.now();
      const summaries = listConversationSummaries(reader, { limit: 100 });
      const elapsedMs = performance.now() - startedAt;

      const groups = summaries.filter((s) => s.isGroup).length;
      const withUnread = summaries.filter((s) => s.unreadCount > 0).length;
      const withInbound = summaries.filter((s) => s.lastInboundGuid !== null).length;

      // Statistics only — safe to print.
      console.info(
        `[live] summaries=${summaries.length} groups=${groups} withUnread=${withUnread} ` +
          `withInbound=${withInbound} latencyMs=${elapsedMs.toFixed(1)}`,
      );

      expect(summaries.length).toBeGreaterThan(0);
      expect(elapsedMs).toBeLessThan(2_000);
      for (const summary of summaries) {
        expect(summary.chatGuid.length).toBeGreaterThan(0);
        expect(summary.lastActivityAtMs).toBeGreaterThan(978_307_200_000);
      }
    } finally {
      reader.close();
    }
  });
});

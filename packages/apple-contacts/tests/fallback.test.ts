import { describe, expect, it } from 'vitest';

import { createFallbackBridge } from '@/index';

describe('fallback contacts bridge', () => {
  it('returns every handle unresolved, in order', async () => {
    const bridge = createFallbackBridge();
    const resolved = await bridge.resolve(['+15550000000', 'a@example.com']);
    expect(resolved).toEqual([
      { handle: '+15550000000', displayName: null },
      { handle: 'a@example.com', displayName: null },
    ]);
  });
});

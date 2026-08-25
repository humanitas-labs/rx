import { describe, expect, it } from 'vitest';

import { commands, decodedBodySchema, events } from '@/index';

describe('contract schemas', () => {
  it('accepts a valid app.status response', () => {
    const parsed = commands['app.status'].response.safeParse({
      version: '0.1.0',
      platform: 'darwin',
      startedAt: 1_756_000_000_000,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an app.status response missing fields', () => {
    expect(commands['app.status'].response.safeParse({ version: '0.1.0' }).success).toBe(false);
  });

  it('accepts a valid heartbeat event and rejects a malformed one', () => {
    expect(events['app.heartbeat'].safeParse({ at: 1, uptimeMs: 0 }).success).toBe(true);
    expect(events['app.heartbeat'].safeParse({ at: 'now' }).success).toBe(false);
  });

  it('validates the decoder output shape from ADR-003', () => {
    const parsed = decodedBodySchema.safeParse({
      text: 'see https://example.com',
      spans: [{ start: 4, end: 23, kind: 'link', value: 'https://example.com' }],
    });
    expect(parsed.success).toBe(true);
    expect(decodedBodySchema.safeParse({ text: 1, spans: [] }).success).toBe(false);
    expect(
      decodedBodySchema.safeParse({ text: '', spans: [{ start: 0, end: 1, kind: 'sparkle' }] })
        .success,
    ).toBe(false);
  });
});

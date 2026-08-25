import { describe, expect, it } from 'vitest';

import { guardCommand, guardEvent } from '@/ipc/registry';

describe('command guard (renderer → main)', () => {
  it('runs the handler for a valid request and returns the validated response', async () => {
    const handler = guardCommand('app.status', () => ({
      version: '0.1.0',
      platform: 'darwin',
      startedAt: 123,
    }));
    await expect(handler({})).resolves.toEqual({
      version: '0.1.0',
      platform: 'darwin',
      startedAt: 123,
    });
  });

  it('rejects a malformed request before the handler runs', async () => {
    let ran = false;
    const handler = guardCommand('app.status', () => {
      ran = true;
      return { version: '0.1.0', platform: 'darwin', startedAt: 123 };
    });
    await expect(handler('not-an-object')).rejects.toThrow(/invalid request/);
    expect(ran).toBe(false);
  });

  it('rejects a handler response that violates the contract', async () => {
    const handler = guardCommand(
      'app.status',
      // @ts-expect-error deliberately broken response to prove runtime guarding
      () => ({ version: 42 }),
    );
    await expect(handler({})).rejects.toThrow(/invalid response/);
  });
});

describe('event guard (main → renderer)', () => {
  it('passes a valid payload through', () => {
    expect(guardEvent('app.heartbeat', { at: 1, uptimeMs: 10 })).toEqual({ at: 1, uptimeMs: 10 });
  });

  it('throws on a malformed payload', () => {
    // @ts-expect-error deliberately broken payload to prove runtime guarding
    expect(() => guardEvent('app.heartbeat', { at: 'now' })).toThrow(/invalid payload/);
  });
});

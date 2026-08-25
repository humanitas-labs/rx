// Contacts bridge over a snapshot loader (ADR-005). All data synthetic.

import { describe, expect, it } from 'vitest';

import { createContactsBridge, type ContactsSnapshot } from '@/index';
import { parseSnapshot } from '@/helper';

/** Synthetic three-byte "image"; the bridge never inspects the format. */
const PHOTO_BYTES = [0xff, 0xd8, 0xff];
const PHOTO_BASE64 = btoa(String.fromCharCode(...PHOTO_BYTES));

const SNAPSHOT: ContactsSnapshot = {
  granted: true,
  contacts: [
    {
      name: 'Ada Fixture',
      phones: ['+1 (555) 010-0001'],
      emails: ['ada@example.com'],
      photo: PHOTO_BASE64,
    },
    { name: 'Grace Fixture', phones: ['555 010 0002'], emails: [] },
    { name: 'Synthetic Labs', phones: [], emails: ['Hello@Example.Org'] },
  ],
};

const load = (snapshot: ContactsSnapshot) => () => Promise.resolve(snapshot);

describe('contacts bridge', () => {
  it('resolves phone handles across formatting and country-code differences', async () => {
    const bridge = createContactsBridge(load(SNAPSHOT));
    await bridge.ready;
    const resolved = await bridge.resolve(['+15550100001', '5550100001', '+15550100002']);
    expect(resolved.map((entry) => entry.displayName)).toEqual([
      'Ada Fixture', // stored formatted, handle E.164: last-10 match
      'Ada Fixture', // bare 10-digit handle
      'Grace Fixture', // stored without country code, handle with
    ]);
  });

  it('resolves emails case-insensitively and leaves unknowns null', async () => {
    const bridge = createContactsBridge(load(SNAPSHOT));
    await bridge.ready;
    const resolved = await bridge.resolve([
      'hello@example.org',
      'nobody@example.net',
      '+15550109999',
    ]);
    expect(resolved).toEqual([
      { handle: 'hello@example.org', displayName: 'Synthetic Labs' },
      { handle: 'nobody@example.net', displayName: null },
      { handle: '+15550109999', displayName: null },
    ]);
  });

  it('resolves nothing while the snapshot is still loading, names after', async () => {
    let release: (snapshot: ContactsSnapshot) => void = () => undefined;
    const bridge = createContactsBridge(
      () => new Promise<ContactsSnapshot>((resolve) => (release = resolve)),
    );
    const before = await bridge.resolve(['ada@example.com']);
    expect(before[0]?.displayName).toBeNull();
    release(SNAPSHOT);
    await bridge.ready;
    const after = await bridge.resolve(['ada@example.com']);
    expect(after[0]?.displayName).toBe('Ada Fixture');
  });

  it('serves a photo for every handle of the card that carries one', async () => {
    const bridge = createContactsBridge(load(SNAPSHOT));
    await bridge.ready;
    expect([...(bridge.photo('+15550100001') ?? [])]).toEqual(PHOTO_BYTES);
    expect([...(bridge.photo('ada@example.com') ?? [])]).toEqual(PHOTO_BYTES);
    expect(bridge.photo('+15550100002')).toBeNull(); // known contact, no photo
    expect(bridge.photo('+15550109999')).toBeNull(); // unknown handle
  });

  it('has no photo before the snapshot loads', () => {
    const bridge = createContactsBridge(() => new Promise<ContactsSnapshot>(() => undefined));
    expect(bridge.photo('+15550100001')).toBeNull();
  });

  it('keeps the name when a photo fails to decode', async () => {
    const bridge = createContactsBridge(
      load({
        granted: true,
        contacts: [
          { name: 'Ada Fixture', phones: ['+15550100001'], emails: [], photo: 'not-base64!!' },
        ],
      }),
    );
    await bridge.ready;
    const resolved = await bridge.resolve(['+15550100001']);
    expect(resolved[0]?.displayName).toBe('Ada Fixture');
    expect(bridge.photo('+15550100001')).toBeNull();
  });

  it('resolves nothing when permission is denied', async () => {
    const bridge = createContactsBridge(load({ granted: false, contacts: [] }));
    await bridge.ready;
    const resolved = await bridge.resolve(['+15550100001']);
    expect(resolved[0]?.displayName).toBeNull();
  });

  it('retries a failed load on the next resolve call', async () => {
    let calls = 0;
    const bridge = createContactsBridge(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('helper-missing')) : Promise.resolve(SNAPSHOT);
    });
    await bridge.ready; // first load fails without throwing
    await bridge.resolve(['ada@example.com']); // triggers the retry
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolved = await bridge.resolve(['ada@example.com']);
    expect(resolved[0]?.displayName).toBe('Ada Fixture');
    expect(calls).toBe(2);
  });
});

describe('helper snapshot parsing', () => {
  it('parses a well-formed document', () => {
    const parsed = parseSnapshot(
      '{"granted":true,"contacts":[{"name":"Ada Fixture","phones":["+15550100001"],"emails":[]}]}',
    );
    expect(parsed.granted).toBe(true);
    expect(parsed.contacts).toEqual([
      { name: 'Ada Fixture', phones: ['+15550100001'], emails: [] },
    ]);
  });

  it('rejects malformed shapes instead of half-resolving', () => {
    expect(() => parseSnapshot('{"granted":"yes","contacts":[]}')).toThrow('contacts-shape');
    expect(() => parseSnapshot('{"granted":true,"contacts":[{"phones":[]}]}')).toThrow(
      'contacts-shape',
    );
    expect(() => parseSnapshot('[]')).toThrow();
  });
});

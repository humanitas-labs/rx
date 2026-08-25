import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { createDecoder, type BodyDecoder } from '@/index';

const wasmPath = fileURLToPath(new URL('../dist/decoder.wasm', import.meta.url));

let decoder: BodyDecoder;

beforeAll(async () => {
  decoder = await createDecoder(await readFile(wasmPath));
});

describe('wasm decoder boundary', () => {
  it('instantiates with zero imports', () => {
    expect(decoder).toBeDefined();
  });

  it('contains empty input as a typed error', () => {
    expect(decoder.decode(new Uint8Array())).toHaveProperty('err');
  });

  it('contains garbage input as a typed error, never a throw', () => {
    const garbage = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) % 251);
    expect(decoder.decode(garbage)).toHaveProperty('err');
  });

  it('survives repeated calls without corrupting memory', () => {
    for (let i = 0; i < 100; i++) {
      const noise = Uint8Array.from({ length: 512 + i }, (_, j) => (j * 13 + i) % 256);
      expect(decoder.decode(noise)).toHaveProperty('err');
    }
  });
});

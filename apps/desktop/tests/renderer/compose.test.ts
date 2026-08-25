// Compose helpers (step 10): handle validation.

import { describe, expect, it } from 'vitest';

import { validHandle } from '../../src/renderer/src/features/compose/compose';

describe('validHandle', () => {
  it('accepts emails and phones, normalizing separators', () => {
    expect(validHandle('fixture@example.com')).toBe('fixture@example.com');
    expect(validHandle(' +1 (555) 000-0001 ')).toBe('+15550000001');
    expect(validHandle('5550001')).toBe('5550001');
  });

  it('rejects short, malformed, or mixed input', () => {
    expect(validHandle('')).toBeNull();
    expect(validHandle('12345')).toBeNull();
    expect(validHandle('not a handle')).toBeNull();
    expect(validHandle('user@')).toBeNull();
    expect(validHandle('+1555abc0001')).toBeNull();
  });
});

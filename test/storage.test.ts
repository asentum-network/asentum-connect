import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageGet, storageRemove, storageSet } from '../src/storage';

afterEach(() => vi.unstubAllGlobals());

describe('storage helpers', () => {
  it('never throw when the localStorage getter itself throws (storage blocked)', () => {
    const w = {};
    Object.defineProperty(w, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    vi.stubGlobal('window', w);
    expect(storageGet('k')).toBeNull();
    expect(() => storageSet('k', 'v')).not.toThrow();
    expect(() => storageRemove('k')).not.toThrow();
  });

  it('never throw when a method throws (quota, sandbox)', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
    vi.stubGlobal('window', { localStorage: bad });
    expect(storageGet('k')).toBeNull();
    expect(() => storageSet('k', 'v')).not.toThrow();
  });

  it('read and write when storage works', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) } });
    storageSet('k', 'v');
    expect(storageGet('k')).toBe('v');
    storageRemove('k');
    expect(storageGet('k')).toBeNull();
  });
});

import { signedMessageBytes } from '../src/message';
describe('signed message bytes', () => {
  it('match the Console verifier and the SDK', () => {
    const msg = 'hi é\nline';
    expect(Buffer.from(signedMessageBytes(msg)).equals(Buffer.concat([Buffer.from(`Asentum Signed Message:\n${Buffer.byteLength(msg)}\n`), Buffer.from(msg)]))).toBe(true);
  });
});

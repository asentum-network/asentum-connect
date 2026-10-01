import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RPC_URL,
  formatHeight,
  isNetworkError,
  metadataMatchesChain,
  normalizeRpcUrl,
  parseFinalizedHeight,
  sameRpcUrl,
  validateRpc,
} from '../src/rpc-validation';

const META_OK = {
  chainId: '0x58f',
  chainName: 'Asentum Testnet',
  chainIdDecimal: '1423',
  currentBlock: '309111',
};
const HEADS_OK = { finalized: '309120', tip: '309121' };

function fakeFetch(routes: Record<string, unknown | Error | 'hang' | number>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) throw new TypeError('Failed to fetch');
    if (r instanceof Error) throw r;
    if (r === 'hang') return new Promise<never>(() => {});
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
  return { impl, calls };
}

describe('normalizeRpcUrl', () => {
  it('strips trailing slashes, query-free, keeps port and path', () => {
    const r = normalizeRpcUrl('  https://rpc.example.com:8545/// ');
    expect(r).toMatchObject({ ok: true, url: 'https://rpc.example.com:8545', host: 'rpc.example.com:8545', insecure: false });
    expect(normalizeRpcUrl('https://x.io/rpc/')).toMatchObject({ ok: true, url: 'https://x.io/rpc' });
  });
  it('treats a bare host as https', () => {
    expect(normalizeRpcUrl('node.example.org')).toMatchObject({ ok: true, url: 'https://node.example.org' });
  });
  it('rejects empty, junk, other schemes, credentials, query and hash', () => {
    for (const bad of ['', '   ', 'ftp://x.com', 'ws://x.com', 'https://user:pw@x.com', 'https://x.com/?a=1', 'https://x.com/#a', 'http://']) {
      expect(normalizeRpcUrl(bad).ok, bad).toBe(false);
    }
  });
  it('allows http only for localhost, loopback and private LAN', () => {
    expect(normalizeRpcUrl('http://localhost:8545')).toMatchObject({ ok: true, insecure: true });
    expect(normalizeRpcUrl('http://127.0.0.1:8545')).toMatchObject({ ok: true, insecure: true });
    expect(normalizeRpcUrl('http://[::1]:8545')).toMatchObject({ ok: true, insecure: true });
    for (const lan of ['http://192.168.1.20:8545', 'http://10.0.0.5:8545', 'http://172.20.1.1:8545']) {
      const r = normalizeRpcUrl(lan);
      expect(r.ok, lan).toBe(true);
      if (r.ok) expect(r.note).toBeTruthy();
    }
    expect(normalizeRpcUrl('http://172.32.0.1:8545').ok).toBe(false);
    expect(normalizeRpcUrl('http://rpc.example.com').ok).toBe(false);
    expect(normalizeRpcUrl('http://8.8.8.8:8545').ok).toBe(false);
  });
  it('can refuse LAN http (extension mode) but still allow localhost', () => {
    expect(normalizeRpcUrl('http://192.168.1.20:8545', { allowLanHttp: false }).ok).toBe(false);
    expect(normalizeRpcUrl('http://localhost:8545', { allowLanHttp: false }).ok).toBe(true);
  });
  it('compares URLs after normalising', () => {
    expect(sameRpcUrl('https://testnet.asentum.com/', DEFAULT_RPC_URL)).toBe(true);
    expect(sameRpcUrl('HTTPS://Testnet.Asentum.com', DEFAULT_RPC_URL)).toBe(true);
    expect(sameRpcUrl('https://other.example.com', DEFAULT_RPC_URL)).toBe(false);
  });
});

describe('response parsing', () => {
  it('accepts chainIdDecimal 1423 or chainId 0x58f', () => {
    expect(metadataMatchesChain(META_OK)).toBe(true);
    expect(metadataMatchesChain({ chainIdDecimal: '1423' })).toBe(true);
    expect(metadataMatchesChain({ chainId: '0x58F' })).toBe(true);
    expect(metadataMatchesChain({ chainId: '0x58e', chainIdDecimal: '1422' })).toBe(false);
    expect(metadataMatchesChain(null)).toBe(false);
    expect(metadataMatchesChain('1423')).toBe(false);
  });
  it('reads a numeric finalized height', () => {
    expect(parseFinalizedHeight(HEADS_OK)).toBe(309120);
    expect(parseFinalizedHeight({ finalized: 42 })).toBe(42);
    expect(parseFinalizedHeight({ finalized: 'abc' })).toBeNull();
    expect(parseFinalizedHeight({ tip: '5' })).toBeNull();
    expect(parseFinalizedHeight(null)).toBeNull();
  });
  it('formats heights with thousands separators', () => {
    expect(formatHeight(309120)).toBe('309,120');
    expect(formatHeight(999)).toBe('999');
    expect(formatHeight(1234567)).toBe('1,234,567');
  });
  it('spots network errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isNetworkError(new Error('RPC GET /balance failed: 500'))).toBe(false);
  });
});

describe('validateRpc', () => {
  const base = 'https://rpc.example.com';
  it('passes a healthy chain-1423 node and reports the height', async () => {
    const { impl, calls } = fakeFetch({ [`${base}/metadata`]: META_OK, [`${base}/v3/heads`]: HEADS_OK });
    const r = await validateRpc(`${base}/`, { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.url).toBe(base);
    expect(r.height).toBe(309120);
    expect(r.checks).toEqual(['Address uses https', 'Node is on chain 1423', 'Finalized block 309,120']);
    expect(calls).toEqual([`${base}/metadata`, `${base}/v3/heads`]);
  });
  it('rejects a node on another chain', async () => {
    const { impl } = fakeFetch({ [`${base}/metadata`]: { chainId: '0x58e', chainIdDecimal: '1422' } });
    const r = await validateRpc(base, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('chain 1422');
  });
  it('rejects when heads has no numeric finalized height', async () => {
    const { impl } = fakeFetch({ [`${base}/metadata`]: META_OK, [`${base}/v3/heads`]: { finalized: null } });
    const r = await validateRpc(base, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(r.checks).toContain('Node is on chain 1423');
  });
  it('reports unreachable, HTTP errors and timeouts in plain words', async () => {
    const unreachable = await validateRpc(base, { fetchImpl: fakeFetch({}).impl });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.error).toContain('could not be reached');

    const http = await validateRpc(base, { fetchImpl: fakeFetch({ [`${base}/metadata`]: 502 }).impl });
    expect(http.error).toContain('HTTP 502');

    const slow = await validateRpc(base, { fetchImpl: fakeFetch({ [`${base}/metadata`]: 'hang' }).impl, timeoutMs: 30 });
    expect(slow.ok).toBe(false);
    expect(slow.error).toContain('did not answer');
  });
  it('never fetches for an invalid URL', async () => {
    const { impl, calls } = fakeFetch({});
    const r = await validateRpc('http://rpc.example.com', { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('carries the http note for a local node', async () => {
    const local = 'http://127.0.0.1:8545';
    const { impl } = fakeFetch({ [`${local}/metadata`]: META_OK, [`${local}/v3/heads`]: HEADS_OK });
    const r = await validateRpc(local, { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.note).toBeTruthy();
  });
});

describe('AsentumClient RPC override', () => {
  it('routes reads to the override, back to the dapp RPC on reset, and reports a dead custom RPC', async () => {
    const { AsentumClient } = await import('../src/client');
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    let down = false;
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      if (down) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ balance: '5' }) } as unknown as Response;
    }) as typeof fetch;
    try {
      const client = new AsentumClient({ rpc: 'https://dapp-rpc.example.com/' });
      expect(client.rpc).toBe('https://dapp-rpc.example.com');
      client.setRpcOverride('https://my-node.example.com:8545/');
      expect(client.isCustomRpc).toBe(true);
      await client.balanceOf('0x72f14d1509758feb87fdeb875d7255871d0329d3');
      expect(seen.pop()).toBe('https://my-node.example.com:8545/balance/0x72f14d1509758feb87fdeb875d7255871d0329d3');

      const errors: unknown[] = [];
      client.onRpcError = (e) => errors.push(e);
      down = true;
      await expect(client.balanceOf('0x72f14d1509758feb87fdeb875d7255871d0329d3')).rejects.toThrow();
      expect(errors.length).toBe(1);

      // explicit "read from default for now": reads go to the dapp RPC, no error reported
      down = false;
      client.setReadFromDefault(true);
      await client.balanceOf('0x72f14d1509758feb87fdeb875d7255871d0329d3');
      expect(seen.pop()).toMatch(/^https:\/\/dapp-rpc\.example\.com\/balance\//);
      expect(client.rpc).toBe('https://my-node.example.com:8545');

      client.setRpcOverride(null);
      expect(client.isCustomRpc).toBe(false);
      expect(client.rpc).toBe('https://dapp-rpc.example.com');

      // setting the override to the dapp RPC itself is not "custom"
      client.setRpcOverride('https://dapp-rpc.example.com');
      expect(client.isCustomRpc).toBe(false);
      expect(() => client.setRpcOverride('http://rpc.example.com')).toThrow();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

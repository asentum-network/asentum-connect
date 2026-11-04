import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsentumClient } from '../src/client';
import {
  InvalidNameError, NAME_REGISTRY_CONTRACT, NameNotFoundError, NamesNotActiveError, formatName, isNameInput, nameFeeWei, normalizeName,
} from '../src/names';

const ASE1 = 'ase1wtc569gfwk87hplaawr46uj4suwsx2wndgf8ue';
const HEX = '0x72f14d1509758feb87fdeb875d7255871d0329d3';

type Route = (path: string, init?: RequestInit) => { status?: number; body: unknown } | Error;
function mockFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = route(new URL(url).pathname, init);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('name helpers', () => {
  it('match the registry rules', () => {
    expect(normalizeName('@Milkie')).toBe('milkie');
    expect(normalizeName('a'.repeat(24))).toBe('a'.repeat(24));
    for (const bad of ['ab', 'a'.repeat(25), '-abc', 'abc-', 'a--b', 'a_b', 'café', 'KKing', '0xabc', 'ase1abc', '@@abc', '']) {
      expect(normalizeName(bad)).toBeNull();
    }
    expect(isNameInput('@milkie')).toBe(true);
    expect(isNameInput('milkie')).toBe(false);
    expect(isNameInput(ASE1)).toBe(false);
    expect(formatName('Milkie')).toBe('@milkie');
    expect(nameFeeWei('abc')).toBe('500000000000000000000');
    expect(nameFeeWei('abcdef')).toBe('10000000000000000000');
    expect(NAME_REGISTRY_CONTRACT).toBe('ase1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqty736ey');
  });
});

describe('client names', () => {
  it('namesActive is false on a node older than 0.9.0 (404) and before the flag day', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not found' } }));
    expect(await new AsentumClient({ rpc: 'http://n' }).namesActive()).toBe(false);
    mockFetch(() => ({ body: { active: false, error: 'names not active', activatesAt: '1200000' } }));
    const c = new AsentumClient({ rpc: 'http://n' });
    expect(await c.namesActive()).toBe(false);
    await expect(c.resolveName('@milkie')).rejects.toBeInstanceOf(NamesNotActiveError);
    await expect(c.resolveRecipient('@milkie')).rejects.toThrow(/1,200,000/);
    expect(await c.primaryName(ASE1)).toBeNull();
  });

  it('namesActive never throws on a network error', async () => {
    mockFetch(() => new TypeError('fetch failed'));
    expect(await new AsentumClient({ rpc: 'http://n' }).namesActive()).toBe(false);
  });

  it('resolveRecipient: @name -> both forms, address passes through without a call', async () => {
    const calls = mockFetch((p) => (p === '/name/milkie' ? { body: { active: true, name: 'milkie', address: HEX, ase1: ASE1 } } : { body: {} }));
    const c = new AsentumClient({ rpc: 'http://n' });
    expect(await c.resolveRecipient('@Milkie')).toEqual({ address: ASE1, hex: HEX, name: 'milkie' });
    expect(await c.resolveRecipient(ASE1)).toEqual({ address: ASE1, hex: HEX, name: null });
    expect(await c.resolveRecipient(HEX)).toEqual({ address: ASE1, hex: HEX, name: null });
    expect(calls).toHaveLength(1);
  });

  it('a free or invalid name blocks', async () => {
    mockFetch(() => ({ body: { active: true, name: 'nobody', address: null, ase1: null } }));
    const c = new AsentumClient({ rpc: 'http://n' });
    await expect(c.resolveRecipient('@nobody')).rejects.toBeInstanceOf(NameNotFoundError);
    await expect(c.resolveRecipient('@a')).rejects.toBeInstanceOf(InvalidNameError);
    await expect(c.resolveRecipient('nobody')).rejects.toThrow(/ase1 address or an @name/);
  });

  it('primaryName: name for an address once live, null when none', async () => {
    mockFetch((p) => (p.startsWith('/name-of/ase1wtc') ? { body: { active: true, address: HEX, ase1: ASE1, name: 'milkie' } } : { body: { active: true, name: null } }));
    const c = new AsentumClient({ rpc: 'http://n' });
    expect(await c.primaryName(HEX)).toBe('milkie');
  });
});

describe('transfer to @name and signMessage through the extension', () => {
  function withExtension(provider: Record<string, unknown>) {
    vi.stubGlobal('window', { asentum: provider, location: { origin: 'https://dapp.test' } });
  }

  it('transfer("@name") resolves first and hands the wallet the 0x address plus the name hint', async () => {
    mockFetch(() => ({ body: { active: true, name: 'milkie', address: HEX, ase1: ASE1 } }));
    const sendTransfer = vi.fn(async () => ({ txHash: '0xabc' }));
    withExtension({ sendTransfer, connect: async () => ({ address: HEX }) });
    const c = new AsentumClient({ rpc: 'http://n' });
    expect(await c.transfer('@milkie', '5')).toBe('0xabc');
    expect(sendTransfer).toHaveBeenCalledWith({ to: HEX, amount: '5', toName: 'milkie' });
  });

  it('transfer("@free") sends nothing', async () => {
    mockFetch(() => ({ body: { active: true, name: 'free', address: null, ase1: null } }));
    const sendTransfer = vi.fn(async () => ({ txHash: '0xabc' }));
    withExtension({ sendTransfer });
    await expect(new AsentumClient({ rpc: 'http://n' }).transfer('@free', '5')).rejects.toBeInstanceOf(NameNotFoundError);
    expect(sendTransfer).not.toHaveBeenCalled();
  });

  it('signMessage uses window.asentum.signMessage; an older extension gets a clear error', async () => {
    const signMessage = vi.fn(async () => ({ address: HEX, publicKey: '0x01', signature: '0x02' }));
    withExtension({ signMessage });
    const c = new AsentumClient();
    expect(c.canSignMessage()).toBe(true);
    expect(await c.signMessage('hello')).toEqual({ address: ASE1, publicKey: '0x01', signature: '0x02', message: 'hello' });
    expect(signMessage).toHaveBeenCalledWith({ message: 'hello' });
    await expect(c.signMessage('bad ‮ text')).rejects.toThrow(/text-direction/);

    withExtension({});
    const old = new AsentumClient();
    expect(old.canSignMessage()).toBe(false);
    await expect(old.signMessage('hello')).rejects.toThrow(/0\.7\.0/);
  });
});

describe('signMessage through the Telegram wallet', () => {
  it('posts a sign_message request and returns the signature once approved', async () => {
    vi.useFakeTimers();
    const calls = mockFetch((p, init) => {
      if (p.endsWith('/sign-request')) return { body: { requestId: 'r1', status: 'pending' } };
      if (p.endsWith('/sign-requests/r1')) return { body: { status: 'approved', txHash: null, signature: '0xsig', publicKey: '0xpub', address: ASE1 } };
      return { body: {} };
    });
    const c = new AsentumClient({ botApi: 'http://bot' });
    c.useBotSession('sess1');
    const p = c.signMessage('Sign in to the Console');
    await vi.advanceTimersByTimeAsync(2100);
    expect(await p).toEqual({ address: ASE1, publicKey: '0xpub', signature: '0xsig', message: 'Sign in to the Console' });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ type: 'sign_message', message: 'Sign in to the Console' });
    vi.useRealTimers();
  });

  it('an older bot (unknown request type) gives a clear error, not a session expiry', async () => {
    mockFetch(() => ({ status: 400, body: { error: 'unknown request type' } }));
    const c = new AsentumClient({ botApi: 'http://bot' });
    c.useBotSession('sess1');
    const expired = vi.fn();
    c.onSessionExpired = expired;
    await expect(c.signMessage('hi')).rejects.toThrow(/cannot sign messages yet/);
    expect(expired).not.toHaveBeenCalled();
  });
});

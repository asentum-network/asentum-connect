import type { AsentumProviderApi, ClientOptions, Receipt } from './types';
import { shortAse1, ase1ToHex, ase1ArgsToHex, hexToAse1, toAse1 } from './ase1';
import {
  InvalidNameError, NAME_REGISTER_GAS, NAME_REGISTRY_HEX, NameNotFoundError, NamesNotActiveError, nameFeeWei, normalizeName,
  type ResolvedRecipient,
} from './names';
import { SignMessageUnsupportedError, signMessageProblem, type SignedMessage } from './message';
import { normalizeRpcUrl, stripTrailingSlashes } from './rpc-validation';

// Accept ase1 or hex from callers; RPC and signers get hex.
const hexAddr = (a: string): string => ase1ToHex(a) ?? a;

export const DEFAULT_RPC = 'https://testnet.asentum.com';
export const DEFAULT_BOT_API = 'https://wallet.asentum.com';

// Thrown when the wallet session behind a signed call is gone (Telegram
// session expired or revoked, extension no longer connected to this site).
// The provider catches it, clears the stale connection and reopens the
// connect modal.
/** Optional gas limit for a contract call (wallets clamp it to their own caps). */
export interface CallGasOptions {
  gasLimit?: number | string | bigint;
  gas?: number | string | bigint;
}

export class SessionExpiredError extends Error {
  constructor(message = 'Your wallet session has expired. Reconnect your wallet to continue.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export interface BotSession {
  sessionId: string;
  code: string;
  expiresAt?: number;
}

// Reads hit the RPC directly: the dapp's `rpc`, or the end user's own RPC when
// they picked one (see setRpcOverride / useRpc). Writes go through the active
// signer: either the browser extension (window.asentum, which uses the RPC set
// in the extension) or a paired Telegram-bot session (the 6-digit-code flow),
// which posts a sign-request the user approves inside their Telegram wallet.
export class AsentumClient {
  /** The dapp's RPC (the `rpc` option, or DEFAULT_RPC). */
  readonly defaultRpc: string;
  readonly botApi: string;
  // End-user RPC override (already validated by the caller), or null.
  private rpcOverride: string | null = null;
  // "Read from the default for now" while the user's own RPC is not answering.
  private readFromDefault = false;
  // Set by the provider: a read against the user's own RPC failed / succeeded.
  onRpcError: ((err: unknown) => void) | null = null;
  onRpcOk: (() => void) | null = null;
  // active signer: 'extension' | 'bot' | null. Bot mode is set via
  // useBotSession() after the code is paired.
  private mode: 'extension' | 'bot' | null = null;
  private botSessionId: string | null = null;
  // Set by the provider; called whenever a signed call finds the session gone.
  onSessionExpired: (() => void) | null = null;

  constructor(opts: ClientOptions = {}) {
    this.defaultRpc = stripTrailingSlashes(opts.rpc || DEFAULT_RPC) || DEFAULT_RPC;
    this.botApi = opts.botApi || DEFAULT_BOT_API;
  }

  /** The RPC in use: the user's own when they set one, else the dapp's. */
  get rpc(): string {
    return this.rpcOverride || this.defaultRpc;
  }

  /** True when the end user picked their own RPC. */
  get isCustomRpc(): boolean {
    return this.rpcOverride != null;
  }

  /** RPC used for reads right now (the default while reading from it on purpose). */
  get readRpc(): string {
    return this.readFromDefault && this.rpcOverride ? this.defaultRpc : this.rpc;
  }

  get readingFromDefault(): boolean {
    return this.readFromDefault && this.rpcOverride != null;
  }

  /**
   * Point reads at the user's own RPC (null goes back to the dapp's). The URL
   * is normalised here but not network-checked; use validateRpc / useRpc's
   * setRpc for that.
   */
  setRpcOverride(url: string | null): void {
    this.readFromDefault = false;
    if (!url) { this.rpcOverride = null; return; }
    const n = normalizeRpcUrl(url);
    if (!n.ok) throw new Error(n.error);
    this.rpcOverride = n.url.toLowerCase() === this.defaultRpc.toLowerCase() ? null : n.url;
  }

  /** Read from the dapp's RPC for now while the user's own is not answering. */
  setReadFromDefault(on: boolean): void {
    this.readFromDefault = on;
  }

  // Every read goes through here so a dead custom RPC is reported, never
  // silently swapped for another node.
  private async readFetch(path: string, init?: RequestInit): Promise<Response> {
    const custom = this.rpcOverride != null && !this.readFromDefault;
    try {
      const res = await fetch(`${this.readRpc}${path}`, init);
      if (custom) this.onRpcOk?.();
      return res;
    } catch (e) {
      if (custom) this.onRpcError?.(e);
      throw e;
    }
  }

  // ── Telegram-bot session (6-digit code pairing) ─────────────────────────
  // Create a pairing session; show the returned `code` to the user, who
  // enters it in their Telegram wallet's Connect flow.
  async createBotSession(dappName?: string): Promise<BotSession> {
    const res = await fetch(`${this.botApi}/api/sessions/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dappOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        dappName: dappName || 'Asentum',
      }),
    });
    if (!res.ok) throw new Error(`bot session create failed: HTTP ${res.status}`);
    return res.json();
  }

  // Poll this until { status: 'connected', address } once the user enters
  // the code in their wallet.
  async getBotSessionStatus(sessionId: string): Promise<{ status: string; address?: string }> {
    const res = await fetch(`${this.botApi}/api/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`bot session status -> HTTP ${res.status}`);
    return res.json();
  }

  // Activate bot mode after a session pairs (called by the provider on connect).
  useBotSession(sessionId: string): void {
    this.mode = 'bot';
    this.botSessionId = sessionId;
  }

  private expired(): never {
    this.onSessionExpired?.();
    throw new SessionExpiredError();
  }

  // True while the active session can still sign. A Telegram session is asked
  // directly; an extension session checks the extension still has an account
  // for this site. Network blips count as live so a flaky connection never
  // logs anyone out.
  async checkSession(): Promise<boolean> {
    if (this.mode === 'bot' && this.botSessionId) {
      try {
        const res = await fetch(`${this.botApi}/api/sessions/${this.botSessionId}`);
        if (res.status === 404 || res.status === 410) return false;
        if (!res.ok) return true;
        const s = await res.json();
        return s.status === 'connected';
      } catch {
        return true;
      }
    }
    if (!this.provider) return false;
    try {
      return !!(await this.provider.getAddress());
    } catch {
      return false;
    }
  }

  private async botSign(payload: Record<string, unknown>): Promise<{ txHash: string; contractAddress?: string; [k: string]: unknown }> {
    if (!this.botSessionId) this.expired();
    const cr = await fetch(`${this.botApi}/api/sessions/${this.botSessionId}/sign-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!cr.ok) {
      const text = await cr.text();
      if (cr.status === 400 && payload.type === 'sign_message' && /unknown request type/i.test(text)) {
        throw new SignMessageUnsupportedError('Your Telegram wallet cannot sign messages yet. Try again after its next update.');
      }
      if (cr.status === 404 || cr.status === 410 || /session|expired|revoked/i.test(text)) this.expired();
      throw new Error(`bot sign-request failed: HTTP ${cr.status} ${text}`);
    }
    const { requestId } = await cr.json();
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const r = await fetch(`${this.botApi}/api/sessions/${this.botSessionId}/sign-requests/${requestId}`);
          if (!r.ok) return; // transient
          const s = await r.json();
          if (s.status === 'approved') { clearInterval(iv); resolve({ ...s, txHash: s.txHash, contractAddress: s.contractAddress }); }
          else if (s.status === 'rejected') { clearInterval(iv); reject(new Error(s.error || 'request rejected in wallet')); }
          else if (s.status === 'expired') { clearInterval(iv); reject(new Error('Request expired after 5 minutes. Approve it sooner next time.')); }
        } catch { /* transient — keep polling */ }
      }, 2000);
    });
  }

  get provider(): AsentumProviderApi | undefined {
    return typeof window !== 'undefined' ? window.asentum : undefined;
  }

  hasWallet(): boolean {
    return !!this.provider;
  }

  private requireProvider(): AsentumProviderApi {
    const p = this.provider;
    if (!p) throw new Error('Asentum wallet extension not found. Install it to continue.');
    return p;
  }

  // Run an extension call; a "not connected / no permission" answer means the
  // site lost its connection, which is a session problem, not a failed tx.
  private async viaExtension<T>(fn: (p: AsentumProviderApi) => Promise<T>): Promise<T> {
    try {
      return await fn(this.requireProvider());
    } catch (e: any) {
      if (/not connected|not authori[sz]ed|permission|connect first|locked/i.test(String(e?.message || ''))) this.expired();
      throw e;
    }
  }

  // wallet
  async connect(): Promise<string> {
    const { address } = await this.requireProvider().connect();
    this.mode = 'extension';
    return address;
  }

  async getAddress(): Promise<string | null> {
    try {
      return await this.requireProvider().getAddress();
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    this.mode = null;
    this.botSessionId = null;
    try {
      await this.provider?.disconnect();
    } catch {
      // provider may not implement disconnect; local state clears anyway
    }
  }

  // reads (no wallet)
  async view<T = unknown>(contract: string, method: string, args: unknown[] = []): Promise<T> {
    contract = hexAddr(contract);
    const res = await this.readFetch('/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract, method, args: ase1ArgsToHex(args) }),
    });
    if (!res.ok) throw new Error(`view ${method} -> HTTP ${res.status}`);
    const j = await res.json();
    if (!j.ok) throw new Error(`view ${method}: ${j.reason || 'failed'}`);
    return j.returnValue as T;
  }

  // native ASE balance, wei decimal string
  async balanceOf(address: string): Promise<string> {
    const res = await this.readFetch(`/balance/${hexAddr(address)}`);
    if (!res.ok) throw new Error(`balance -> HTTP ${res.status}`);
    const j = await res.json();
    return String(j.balance ?? '0');
  }

  // writes — routed through the active signer (bot session or extension)
  // `opts.gasLimit` is a hint for wallets that take one (extension 0.7.0+,
  // the Telegram wallet); older wallets use their own default.
  // `opts.gas` is an alias of `opts.gasLimit`. Without either, nothing is sent
  // and the wallet uses its default, as before.
  async call(contract: string, method: string, args: unknown[] = [], value: string | bigint = '0', opts: CallGasOptions = {}): Promise<string> {
    contract = hexAddr(contract);
    // ase1 inside args becomes 0x: contracts compare against hex msg.sender.
    args = ase1ArgsToHex(args);
    const limit = opts.gasLimit ?? opts.gas;
    const n = limit == null ? NaN : Number(limit);
    const gas = Number.isSafeInteger(n) && n > 0 ? { gasLimit: String(n) } : {};
    if (this.mode === 'bot') {
      const { txHash } = await this.botSign({ type: 'contract_call', to: contract, method, args, value: String(value), ...gas });
      return txHash;
    }
    const { txHash } = await this.viaExtension((p) => p.callContract({
      to: contract, method, args, value: String(value), ...gas,
    }));
    return txHash;
  }

  // `to` may be an address (ase1 or 0x) or "@name". A name is resolved here,
  // right before signing, and passed to the wallet as the 0x address plus a
  // `toName` hint; the wallet resolves the name again itself before it shows
  // both on its approval screen. A name that does not resolve throws
  // (NameNotFoundError / NamesNotActiveError) and nothing is sent.
  async transfer(to: string, amount: string | bigint): Promise<string> {
    let toName: string | undefined;
    if (typeof to === 'string' && to.trim().startsWith('@')) {
      const r = await this.resolveRecipient(to);
      to = r.hex;
      toName = r.name ?? undefined;
    } else {
      to = hexAddr(to);
    }
    const hint = toName ? { toName } : {};
    if (this.mode === 'bot') {
      const { txHash } = await this.botSign({ type: 'transfer', to, amount: String(amount), ...hint });
      return txHash;
    }
    const { txHash } = await this.viaExtension((p) => p.sendTransfer({ to, amount: String(amount), ...hint }));
    return txHash;
  }

  // ── Signed messages (wallet sign-in) ────────────────────────────────────
  // The wallet shows the full text and the site, the user approves, and the
  // answer is { address, publicKey, signature, message }. Verify it on the
  // server (see signedMessageBytes); never trust it in the browser alone.
  /** True when the active wallet can sign messages (a Telegram wallet is asked when you call). */
  canSignMessage(): boolean {
    if (this.mode === 'bot') return true;
    const p = this.provider;
    return !!p && typeof p.signMessage === 'function';
  }

  async signMessage(message: string): Promise<SignedMessage> {
    const problem = signMessageProblem(message);
    if (problem) throw new Error(`cannot sign this message: ${problem}`);
    if (this.mode === 'bot') {
      const r = await this.botSign({ type: 'sign_message', message });
      if (typeof r.signature !== 'string' || typeof r.publicKey !== 'string') throw new Error('the Telegram wallet did not return a signature');
      return { address: toAse1(String(r.address || '')), publicKey: r.publicKey, signature: r.signature, message };
    }
    const p = this.requireProvider();
    if (typeof p.signMessage !== 'function') {
      throw new SignMessageUnsupportedError('Your Asentum wallet extension cannot sign messages yet. Update it to 0.7.0 or later.');
    }
    const r = await this.viaExtension((pp) => pp.signMessage!({ message }));
    return { address: toAse1(r.address), publicKey: r.publicKey, signature: r.signature, message };
  }

  // ── Names (@usernames) ──────────────────────────────────────────────────
  // Every name feature is off until the node says the registry is live. A
  // node older than 0.9.0 answers 404, which counts as "not live".
  private namesCache: { rpc: string; active: boolean; at: number } | null = null;
  private primaryCache = new Map<string, { name: string | null; at: number }>();

  private async nameRead(path: string): Promise<any> {
    const res = await this.readFetch(path);
    if (res.status === 404) throw new NamesNotActiveError(null);
    if (!res.ok) throw new Error(`name lookup -> HTTP ${res.status}`);
    const j = await res.json();
    if (j && j.active === false && j.error === 'names not active') {
      throw new NamesNotActiveError(j.activatesAt != null ? Number(j.activatesAt) : null);
    }
    if (j && j.error === 'invalid name') throw new InvalidNameError(path.split('/').pop() || '');
    if (j && j.error) throw new Error(`name lookup failed: ${j.error}`);
    return j;
  }

  /**
   * True when names are live on the read RPC. Cached for a minute (a failed
   * check for 15 s), so the kit lights names up at the flag day without a
   * reload. Never throws.
   */
  async namesActive(): Promise<boolean> {
    const rpc = this.readRpc;
    const c = this.namesCache;
    if (c && c.rpc === rpc && Date.now() - c.at < (c.active ? 60_000 : 15_000)) return c.active;
    let active = false;
    try {
      await this.nameRead(`/name-of/${NAME_REGISTRY_HEX}`);
      active = true;
    } catch {
      active = false;
    }
    this.namesCache = { rpc, active, at: Date.now() };
    return active;
  }

  /** The ase1 owner of a name ("@Milkie" and "milkie" are the same), or null when it is free. */
  async resolveName(name: string): Promise<string | null> {
    const n = normalizeName(name);
    if (n === null) throw new InvalidNameError(name);
    const j = await this.nameRead(`/name/${encodeURIComponent(n)}`);
    const owner = j.ase1 || (j.address ? hexToAse1(j.address) : '');
    return owner || null;
  }

  /** An address's primary name without the @, or null. Throws NamesNotActiveError before the flag day. */
  async lookupAddress(address: string): Promise<string | null> {
    const j = await this.nameRead(`/name-of/${encodeURIComponent(toAse1(address))}`);
    return typeof j.name === 'string' && j.name ? j.name : null;
  }

  /**
   * For display: an address's primary name, or null when it has none, names
   * are not live, or the lookup failed. Cached for a minute. Never throws.
   */
  async primaryName(address: string): Promise<string | null> {
    const key = toAse1(address);
    if (!key) return null;
    const hit = this.primaryCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.name;
    if (!(await this.namesActive())) return null;
    let name: string | null = null;
    try {
      name = await this.lookupAddress(key);
    } catch {
      return null;
    }
    const n = normalizeName(name ?? '');
    this.primaryCache.set(key, { name: n, at: Date.now() });
    return n;
  }

  /**
   * A "to" field to an address. "@name" is resolved (throws NameNotFoundError
   * for a free name, NamesNotActiveError before the flag day); an ase1 or 0x
   * address passes through. Returns both, so your confirm screen can show
   * "@name" and the ase1 address.
   */
  async resolveRecipient(input: string): Promise<ResolvedRecipient> {
    const s = typeof input === 'string' ? input.trim() : '';
    const hex = ase1ToHex(s) ?? (/^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : null);
    if (hex) return { address: hexToAse1(hex), hex, name: null };
    if (!s.startsWith('@')) throw new Error('Enter an ase1 address or an @name.');
    const name = normalizeName(s);
    if (name === null) throw new InvalidNameError(s);
    const owner = await this.resolveName(name);
    if (!owner) throw new NameNotFoundError(name);
    const ownerHex = ase1ToHex(owner);
    if (!ownerHex) throw new Error(`@${name} resolved to an invalid address`);
    return { address: owner, hex: ownerHex, name };
  }

  /** Registration facts for a name: availability, reason, and the exact fee in wei. */
  async nameAvailability(name: string): Promise<{ name: string | null; available: boolean; reason: string | null; feeWei: string | null }> {
    if (!(await this.namesActive())) throw new NamesNotActiveError(null);
    const r = await this.view<{ name: string | null; available: boolean; reason: string | null; fee: string | null }>(
      NAME_REGISTRY_HEX, 'isAvailable', [name],
    );
    return { name: r?.name ?? null, available: !!r?.available, reason: r?.reason ?? null, feeWei: r?.fee ?? null };
  }

  /**
   * Register a name for the connected account (the wallet asks the user). The
   * value is the exact fee; the first name also becomes the primary name.
   */
  async registerName(name: string): Promise<string> {
    const n = normalizeName(name);
    if (n === null) throw new InvalidNameError(name);
    const a = await this.nameAvailability(n);
    if (!a.available) throw new Error(`@${n} is not available${a.reason ? `: ${a.reason}` : ''}`);
    const fee = a.feeWei ?? nameFeeWei(n)!;
    return this.call(NAME_REGISTRY_HEX, 'register', [n], fee, { gasLimit: NAME_REGISTER_GAS });
  }

  /** Make one of your names the one shown for your address. */
  async setPrimaryName(name: string): Promise<string> {
    const n = normalizeName(name);
    if (n === null) throw new InvalidNameError(name);
    if (!(await this.namesActive())) throw new NamesNotActiveError(null);
    this.primaryCache.clear();
    return this.call(NAME_REGISTRY_HEX, 'setPrimary', [n], '0', { gasLimit: NAME_REGISTER_GAS });
  }

  async deploy(source: string): Promise<{ txHash: string; contractAddress: string }> {
    if (this.mode === 'bot') {
      const r = await this.botSign({ type: 'contract_deploy', source });
      return { txHash: r.txHash, contractAddress: r.contractAddress || '' };
    }
    return this.viaExtension((p) => p.deployContract({ source }));
  }

  // poll a receipt until it lands
  async waitReceipt(txHash: string, timeoutMs = 60000): Promise<Receipt> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await this.readFetch(`/receipts/${txHash}`);
        if (r.ok) {
          const j = await r.json();
          if (j && j.blockNumber) return j as Receipt;
        }
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('receipt timeout');
  }
}

// Shortened address for display, always ase1 (hex input is converted).
export function shortAddress(a?: string | null, lead = 10, tail = 6): string {
  return shortAse1(a, lead, tail);
}

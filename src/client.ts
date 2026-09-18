import type { AsentumProviderApi, ClientOptions, Receipt } from './types';

export const DEFAULT_RPC = 'https://testnet.asentum.com';
export const DEFAULT_BOT_API = 'https://wallet.asentum.com';

export interface BotSession {
  sessionId: string;
  code: string;
  expiresAt?: number;
}

// Reads hit the public RPC directly. Writes go through the active signer:
// either the browser extension (window.asentum) or a paired Telegram-bot
// session (the 6-digit-code flow), which posts a sign-request the user
// approves inside their Telegram wallet.
export class AsentumClient {
  readonly rpc: string;
  readonly botApi: string;
  // active signer: 'extension' | 'bot' | null. Bot mode is set via
  // useBotSession() after the code is paired.
  private mode: 'extension' | 'bot' | null = null;
  private botSessionId: string | null = null;

  constructor(opts: ClientOptions = {}) {
    this.rpc = opts.rpc || DEFAULT_RPC;
    this.botApi = opts.botApi || DEFAULT_BOT_API;
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

  private async botSign(payload: Record<string, unknown>): Promise<{ txHash: string; contractAddress?: string }> {
    if (!this.botSessionId) throw new Error('no active bot session, reconnect your wallet');
    const cr = await fetch(`${this.botApi}/api/sessions/${this.botSessionId}/sign-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!cr.ok) throw new Error(`bot sign-request failed: HTTP ${cr.status} ${await cr.text()}`);
    const { requestId } = await cr.json();
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const r = await fetch(`${this.botApi}/api/sessions/${this.botSessionId}/sign-requests/${requestId}`);
          if (!r.ok) return; // transient
          const s = await r.json();
          if (s.status === 'approved') { clearInterval(iv); resolve({ txHash: s.txHash, contractAddress: s.contractAddress }); }
          else if (s.status === 'rejected') { clearInterval(iv); reject(new Error(s.error || 'request rejected in wallet')); }
          else if (s.status === 'expired') { clearInterval(iv); reject(new Error('request expired (5 min) — approve faster next time')); }
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
    const res = await fetch(`${this.rpc}/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract, method, args }),
    });
    if (!res.ok) throw new Error(`view ${method} -> HTTP ${res.status}`);
    const j = await res.json();
    if (!j.ok) throw new Error(`view ${method}: ${j.reason || 'failed'}`);
    return j.returnValue as T;
  }

  // native ASE balance, wei decimal string
  async balanceOf(address: string): Promise<string> {
    const res = await fetch(`${this.rpc}/balance/${address}`);
    if (!res.ok) throw new Error(`balance -> HTTP ${res.status}`);
    const j = await res.json();
    return String(j.balance ?? '0');
  }

  // writes — routed through the active signer (bot session or extension)
  async call(contract: string, method: string, args: unknown[] = [], value: string | bigint = '0'): Promise<string> {
    if (this.mode === 'bot') {
      const { txHash } = await this.botSign({ type: 'contract_call', to: contract, method, args, value: String(value) });
      return txHash;
    }
    const { txHash } = await this.requireProvider().callContract({
      to: contract, method, args, value: String(value),
    });
    return txHash;
  }

  async transfer(to: string, amount: string | bigint): Promise<string> {
    if (this.mode === 'bot') {
      const { txHash } = await this.botSign({ type: 'transfer', to, amount: String(amount) });
      return txHash;
    }
    const { txHash } = await this.requireProvider().sendTransfer({ to, amount: String(amount) });
    return txHash;
  }

  async deploy(source: string): Promise<{ txHash: string; contractAddress: string }> {
    if (this.mode === 'bot') {
      const r = await this.botSign({ type: 'contract_deploy', source });
      return { txHash: r.txHash, contractAddress: r.contractAddress || '' };
    }
    return this.requireProvider().deployContract({ source });
  }

  // poll a receipt until it lands
  async waitReceipt(txHash: string, timeoutMs = 60000): Promise<Receipt> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(`${this.rpc}/receipts/${txHash}`);
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

// 0x1234…abcd
export function shortAddress(a?: string | null, lead = 6, tail = 4): string {
  if (!a) return '';
  return a.length > lead + tail ? `${a.slice(0, lead)}…${a.slice(-tail)}` : a;
}

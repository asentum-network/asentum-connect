import type { AsentumProviderApi, ClientOptions, Receipt } from './types';

export const DEFAULT_RPC = 'https://testnet.asentum.com';

// Reads hit the public RPC directly. Writes go through the extension
// (window.asentum), which prompts the user to sign.
export class AsentumClient {
  readonly rpc: string;

  constructor(opts: ClientOptions = {}) {
    this.rpc = opts.rpc || DEFAULT_RPC;
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

  // writes (extension-signed)
  async call(contract: string, method: string, args: unknown[] = [], value: string | bigint = '0'): Promise<string> {
    const { txHash } = await this.requireProvider().callContract({
      to: contract, method, args, value: String(value),
    });
    return txHash;
  }

  async transfer(to: string, amount: string | bigint): Promise<string> {
    const { txHash } = await this.requireProvider().sendTransfer({ to, amount: String(amount) });
    return txHash;
  }

  async deploy(source: string): Promise<{ txHash: string; contractAddress: string }> {
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

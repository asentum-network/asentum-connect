// window.asentum, injected by the extension
export interface AsentumProviderApi {
  getAddress(): Promise<string>;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  // toName: the "@name" the dapp resolved `to` from; the wallet re-resolves it before showing it.
  sendTransfer(p: { to: string; amount: string; toName?: string }): Promise<{ txHash: string }>;
  callContract(p: { to: string; method: string; args?: unknown[]; value?: string; gasLimit?: string }): Promise<{ txHash: string }>;
  viewContract(p: { to: string; method: string; args?: unknown[] }): Promise<{ result: unknown }>;
  deployContract(p: { source: string }): Promise<{ txHash: string; contractAddress: string }>;
  /** Extension 0.7.0+: sign a message after the user approves the full text. */
  signMessage?(p: { message: string }): Promise<{ address: string; publicKey: string; signature: string }>;
  /** Extension 0.7.0+: feature list, e.g. ['signMessage', 'names']. */
  features?: string[];
}

declare global {
  interface Window {
    asentum?: AsentumProviderApi;
  }
}

export interface ClientOptions {
  /** Public RPC base for read-only /view + /balance calls. */
  rpc?: string;
  /** Telegram-bot wallet API base (default https://wallet.asentum.com). */
  botApi?: string;
}

export interface Receipt {
  txHash: string;
  blockNumber: string;
  success: boolean;
  gasUsed?: string;
  [k: string]: unknown;
}

export interface WalletState {
  /** Connected address exactly as the wallet returned it (for RPC and contract calls). */
  address: string | null;
  /** The same address in ase1 form, for anything shown to the user. */
  ase1Address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

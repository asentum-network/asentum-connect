// window.asentum, injected by the extension
export interface AsentumProviderApi {
  getAddress(): Promise<string>;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  sendTransfer(p: { to: string; amount: string }): Promise<{ txHash: string }>;
  callContract(p: { to: string; method: string; args?: unknown[]; value?: string }): Promise<{ txHash: string }>;
  viewContract(p: { to: string; method: string; args?: unknown[] }): Promise<{ result: unknown }>;
  deployContract(p: { source: string }): Promise<{ txHash: string; contractAddress: string }>;
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

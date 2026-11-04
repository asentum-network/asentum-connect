import { useCallback, useEffect, useState } from 'react';
import { useAsentumContext } from './context';
import type { SetRpcResult } from './context';
import type { AsentumClient } from './client';
import type { SignedMessage } from './message';

// wallet state + actions
export function useWallet() {
  const c = useAsentumContext();
  const { name } = usePrimaryName();
  const client = c.client;
  const signMessage = useCallback((message: string): Promise<SignedMessage> => client.signMessage(message), [client]);
  return {
    address: c.address,
    ase1Address: c.ase1Address,
    /** The connected account's primary name without @ ("milkie"), or null (also before names go live). */
    name,
    connected: c.connected,
    connecting: c.connecting,
    error: c.error,
    hasWallet: c.hasWallet,
    connect: c.connect,
    disconnect: c.disconnect,
    openConnect: c._openModal,
    /** Ask the wallet to sign a message (wallet sign-in). Resolves to { address, publicKey, signature, message }. */
    signMessage,
    /** False for an extension older than 0.7.0. A Telegram wallet reports true and is asked when you call. */
    canSignMessage: c.connected && client.canSignMessage(),
  };
}

// True once the read RPC serves names (re-checked every minute, so it turns
// on at the flag day without a reload). False on nodes older than 0.9.0.
export function useNamesActive(pollMs = 60000): boolean {
  const client = useAsentum();
  const rpc = useAsentumContext().rpcState;
  const rpcKey = `${rpc.rpc}|${rpc.readingFromDefault}`;
  const [active, setActive] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => { client.namesActive().then((a) => { if (live) setActive(a); }); };
    check();
    const t = pollMs ? setInterval(check, pollMs) : null;
    return () => { live = false; if (t) clearInterval(t); };
  }, [client, rpcKey, pollMs]);
  return active;
}

// The primary name of an address (default: the connected wallet). `name` is
// without @, `display` is "@name"; both null when it has none or names are
// not live yet.
export function usePrimaryName(address?: string | null, pollMs = 60000): { name: string | null; display: string | null; refresh: () => void } {
  const c = useAsentumContext();
  const client = c.client;
  const target = address === undefined ? c.address : address;
  const rpcKey = `${c.rpcState.rpc}|${c.rpcState.readingFromDefault}`;
  const [name, setName] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    if (!target) { setName(null); return; }
    const load = () => { client.primaryName(target).then((n) => { if (live) setName(n); }); };
    load();
    const t = pollMs ? setInterval(load, pollMs) : null;
    return () => { live = false; if (t) clearInterval(t); };
  }, [client, target, rpcKey, pollMs, tick]);
  return { name, display: name ? `@${name}` : null, refresh };
}

// the client for reads + writes
export function useAsentum(): AsentumClient {
  return useAsentumContext().client;
}

// The RPC used for reads, and the end user's own-RPC setting.
// setRpc(url) checks the node (chain 1423, finalized height) before saving.
export function useRpc(): {
  rpc: string;
  defaultRpc: string;
  isCustom: boolean;
  allowed: boolean;
  failing: boolean;
  readingFromDefault: boolean;
  setRpc: (url: string) => Promise<SetRpcResult>;
  resetRpc: () => void;
  readFromDefault: (on: boolean) => void;
} {
  const c = useAsentumContext();
  return { ...c.rpcState, setRpc: c.setRpc, resetRpc: c.resetRpc, readFromDefault: c.readFromDefault };
}

// bind to one contract address
export function useContract(address: string) {
  const client = useAsentum();
  return {
    address,
    view: <T = unknown>(method: string, args: unknown[] = []) => client.view<T>(address, method, args),
    call: (method: string, args: unknown[] = [], value: string | bigint = '0') => client.call(address, method, args, value),
  };
}

// live native ASE balance, defaults to the connected wallet
export function useBalance(address?: string, pollMs = 12000) {
  const client = useAsentum();
  const { address: connected } = useWallet();
  // re-fetch straight away when the user switches RPC
  const readRpc = useAsentumContext().rpcState;
  const rpcKey = `${readRpc.rpc}|${readRpc.readingFromDefault}`;
  const target = address || connected;
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!target) { setBalance(null); return; }
    setLoading(true);
    try { setBalance(await client.balanceOf(target)); } catch { /* ignore */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, target, rpcKey]);

  useEffect(() => {
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { balance, loading, refresh };
}

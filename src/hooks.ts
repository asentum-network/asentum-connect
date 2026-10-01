import { useCallback, useEffect, useState } from 'react';
import { useAsentumContext } from './context';
import type { SetRpcResult } from './context';
import type { AsentumClient } from './client';

// wallet state + actions
export function useWallet() {
  const c = useAsentumContext();
  return {
    address: c.address,
    ase1Address: c.ase1Address,
    connected: c.connected,
    connecting: c.connecting,
    error: c.error,
    hasWallet: c.hasWallet,
    connect: c.connect,
    disconnect: c.disconnect,
    openConnect: c._openModal,
  };
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

import { useCallback, useEffect, useState } from 'react';
import { useAsentumContext } from './context';
import type { AsentumClient } from './client';

// wallet state + actions
export function useWallet() {
  const c = useAsentumContext();
  return {
    address: c.address,
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
  const target = address || connected;
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!target) { setBalance(null); return; }
    setLoading(true);
    try { setBalance(await client.balanceOf(target)); } catch { /* ignore */ } finally { setLoading(false); }
  }, [client, target]);

  useEffect(() => {
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { balance, loading, refresh };
}

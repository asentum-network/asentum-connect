import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AsentumClient } from './client';
import type { WalletState } from './types';

const STORAGE_KEY = 'asentum:connect:address';

export interface AsentumContextValue extends WalletState {
  client: AsentumClient;
  hasWallet: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  _openModal: () => void;
  _closeModal: () => void;
  _modalOpen: boolean;
  telegramBot?: string;
  onCreateWallet?: () => void | Promise<void>;
}

const Ctx = createContext<AsentumContextValue | null>(null);

export interface AsentumProviderProps {
  children: React.ReactNode;
  // defaults to https://testnet.asentum.com
  rpc?: string;
  // bot username without @; when set the modal shows the Telegram option
  telegramBot?: string;
  // when set the modal shows the create-new option
  onCreateWallet?: () => void | Promise<void>;
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
  // persist connected address to localStorage, default true
  persist?: boolean;
}

export function AsentumProvider({
  children, rpc, telegramBot, onCreateWallet, onConnect, onDisconnect, persist = true,
}: AsentumProviderProps) {
  const client = useMemo(() => new AsentumClient({ rpc }), [rpc]);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  // rehydrate a previously-connected address
  useEffect(() => {
    if (!persist || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setAddress(saved);
  }, [persist]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await client.connect();
      setAddress(addr);
      if (persist && typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, addr);
      onConnectRef.current?.(addr);
      setModalOpen(false);
      return addr;
    } catch (e: any) {
      setError(e?.message || 'connect failed');
      return null;
    } finally {
      setConnecting(false);
    }
  }, [client, persist]);

  const disconnect = useCallback(async () => {
    await client.disconnect();
    setAddress(null);
    if (persist && typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
    onDisconnectRef.current?.();
  }, [client, persist]);

  const value: AsentumContextValue = {
    client,
    address,
    connected: !!address,
    connecting,
    error,
    hasWallet: client.hasWallet(),
    connect,
    disconnect,
    telegramBot,
    onCreateWallet,
    _openModal: () => setModalOpen(true),
    _closeModal: () => setModalOpen(false),
    _modalOpen: modalOpen,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAsentumContext(): AsentumContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAsentum hooks must be used inside <AsentumProvider>');
  return v;
}

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
  dappName?: string;
  onCreateWallet?: () => void | Promise<void>;
  extensionStatus: 'ready' | 'soon';
  // finalize a paired Telegram-bot session (called by the modal's code flow)
  _connectBot: (p: { address: string; sessionId: string }) => void;
  _setError: (msg: string | null) => void;
  // true while the connected wallet can still sign
  checkSession: () => Promise<boolean>;
}

const Ctx = createContext<AsentumContextValue | null>(null);

export interface AsentumProviderProps {
  children: React.ReactNode;
  // defaults to https://testnet.asentum.com
  rpc?: string;
  // bot username without @; when set the modal shows the Telegram option
  telegramBot?: string;
  // Telegram-bot wallet API base (default https://wallet.asentum.com)
  botApi?: string;
  // name shown in the wallet's approval prompt
  dappName?: string;
  // when set the modal shows the create-new option
  onCreateWallet?: () => void | Promise<void>;
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
  // persist connected address to localStorage, default true
  persist?: boolean;
  // browser-extension option: 'ready' (default) offers the Asentum extension;
  // 'soon' renders it disabled with a Soon chip
  // until the extension ships; 'ready' makes it connectable again
  extensionStatus?: 'ready' | 'soon';
}

export function AsentumProvider({
  children, rpc, telegramBot, botApi, dappName, onCreateWallet, onConnect, onDisconnect, persist = true,
  extensionStatus = 'ready',
}: AsentumProviderProps) {
  const client = useMemo(() => new AsentumClient({ rpc, botApi }), [rpc, botApi]);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  // A signed call found the session gone: drop the stale connection so the
  // header stops showing "connected", and ask the user to reconnect.
  const expireSession = useCallback(() => {
    setAddress(null);
    if (persist && typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
    setError('Your wallet session has expired. Connect again to continue.');
    setModalOpen(true);
    onDisconnectRef.current?.();
  }, [persist]);

  useEffect(() => {
    client.onSessionExpired = expireSession;
    return () => { client.onSessionExpired = null; };
  }, [client, expireSession]);

  // rehydrate a previously-connected wallet (address + method + bot session),
  // then confirm the session is still live before trusting it
  useEffect(() => {
    if (!persist || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    let restored = false;
    try {
      const s = JSON.parse(saved);
      if (s && s.address) {
        setAddress(s.address);
        if (s.method === 'bot' && s.sessionId) client.useBotSession(s.sessionId);
        restored = s.method === 'bot';
      }
    } catch {
      // legacy: bare address string
      setAddress(saved);
    }
    if (restored) {
      client.checkSession().then((live) => { if (!live) expireSession(); });
    }
  }, [persist, client, expireSession]);

  // Re-check when the tab comes back into focus: a Telegram session can
  // expire or be revoked while the page sits in the background.
  useEffect(() => {
    if (typeof window === 'undefined' || !address) return;
    const onFocus = () => {
      client.checkSession().then((live) => { if (!live) expireSession(); });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [client, address, expireSession]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const addr = await client.connect();
      setAddress(addr);
      if (persist && typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ address: addr, method: 'extension' }));
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

  // Finalize a paired Telegram-bot session: the modal's code flow calls this
  // once getBotSessionStatus returns { status:'connected', address }.
  const connectBot = useCallback((p: { address: string; sessionId: string }) => {
    client.useBotSession(p.sessionId);
    setAddress(p.address);
    setError(null);
    if (persist && typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ address: p.address, method: 'bot', sessionId: p.sessionId }));
    }
    onConnectRef.current?.(p.address);
    setModalOpen(false);
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
    dappName,
    onCreateWallet,
    extensionStatus,
    _connectBot: connectBot,
    _setError: setError,
    checkSession: () => client.checkSession(),
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

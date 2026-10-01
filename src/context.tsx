import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AsentumClient } from './client';
import { toAse1 } from './ase1';
import type { WalletState } from './types';
import {
  isLocalHost, isNetworkError, normalizeRpcUrl, validateRpc,
} from './rpc-validation';

const STORAGE_KEY = 'asentum:connect:address';
// The end user's own RPC, if they chose one. Plain URL string.
export const RPC_STORAGE_KEY = 'asentum.rpc';

function readSavedRpc(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(RPC_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSavedRpc(url: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (url) window.localStorage.setItem(RPC_STORAGE_KEY, url);
    else window.localStorage.removeItem(RPC_STORAGE_KEY);
  } catch {
    // storage blocked (private mode, sandboxed iframe): keep it for this page only
  }
}

export interface SetRpcResult {
  ok: boolean;
  /** Finalized block height of the node, when it answered. */
  height?: number;
  /** Plain-English reason it was not accepted. */
  error?: string;
  /** What was checked, in order, e.g. "Node is on chain 1423". */
  checks?: string[];
  /** Note about plain http, when relevant. */
  note?: string;
}

export interface RpcState {
  /** RPC in use (the user's own when set, else the dapp's). */
  rpc: string;
  /** The dapp's RPC. */
  defaultRpc: string;
  isCustom: boolean;
  /** False when the dapp passed allowCustomRpc={false}. */
  allowed: boolean;
  /** The user's own RPC stopped answering (a read failed with a network error). */
  failing: boolean;
  /** Reads are going to the dapp's RPC for now, by the user's choice. */
  readingFromDefault: boolean;
}

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
  rpcState: RpcState;
  setRpc: (url: string) => Promise<SetRpcResult>;
  resetRpc: () => void;
  readFromDefault: (on: boolean) => void;
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
  // let the END USER point reads (view, balance, receipts) at their own node,
  // saved in localStorage under 'asentum.rpc'. Default true. Transactions
  // signed in the browser extension use the extension's own RPC setting.
  allowCustomRpc?: boolean;
}

export function AsentumProvider({
  children, rpc, telegramBot, botApi, dappName, onCreateWallet, onConnect, onDisconnect, persist = true,
  extensionStatus = 'ready', allowCustomRpc = true,
}: AsentumProviderProps) {
  const client = useMemo(() => new AsentumClient({ rpc, botApi }), [rpc, botApi]);
  const [rpcOverride, setRpcOverride] = useState<string | null>(null);
  const [rpcFailing, setRpcFailing] = useState(false);
  const [readingFromDefault, setReadingFromDefault] = useState(false);
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

  // Apply the user's saved RPC after mount (never during render, so SSR and
  // hydration see the dapp's RPC). Re-applied when the client is rebuilt.
  useEffect(() => {
    let applied: string | null = null;
    if (allowCustomRpc) {
      const saved = readSavedRpc();
      const n = saved ? normalizeRpcUrl(saved) : null;
      if (n && n.ok) {
        try {
          client.setRpcOverride(n.url);
          applied = client.isCustomRpc ? client.rpc : null;
        } catch {
          applied = null;
        }
      }
    }
    if (!applied) client.setRpcOverride(null);
    setRpcOverride(applied);
    setRpcFailing(false);
    setReadingFromDefault(false);
  }, [client, allowCustomRpc]);

  // Report a dead custom RPC instead of silently switching nodes.
  useEffect(() => {
    client.onRpcError = (e) => { if (isNetworkError(e)) setRpcFailing(true); };
    client.onRpcOk = () => setRpcFailing(false);
    return () => { client.onRpcError = null; client.onRpcOk = null; };
  }, [client]);

  const setRpc = useCallback(async (url: string): Promise<SetRpcResult> => {
    if (!allowCustomRpc) return { ok: false, error: 'This app does not allow a custom RPC.' };
    const n = normalizeRpcUrl(url);
    if (!n.ok) return { ok: false, error: n.error };
    // An https page cannot call a plain-http node on the network (mixed content).
    if (n.insecure && typeof window !== 'undefined' && window.location?.protocol === 'https:') {
      const hostname = n.host.replace(/:\d+$/, '');
      const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(hostname);
      if (!loopback && isLocalHost(hostname)) {
        return { ok: false, error: 'This page uses https, so your browser will block a plain http node on your network. Use an https address.' };
      }
    }
    const result = await validateRpc(n.url);
    if (!result.ok || !result.url || result.height == null) {
      return { ok: false, error: result.error || 'The node did not pass the checks.', checks: result.checks, note: result.note };
    }
    client.setRpcOverride(result.url);
    const applied = client.isCustomRpc ? client.rpc : null;
    writeSavedRpc(applied);
    setRpcOverride(applied);
    setRpcFailing(false);
    setReadingFromDefault(false);
    return { ok: true, height: result.height, checks: result.checks, note: result.note };
  }, [client, allowCustomRpc]);

  const resetRpc = useCallback(() => {
    client.setRpcOverride(null);
    writeSavedRpc(null);
    setRpcOverride(null);
    setRpcFailing(false);
    setReadingFromDefault(false);
  }, [client]);

  const readFromDefault = useCallback((on: boolean) => {
    client.setReadFromDefault(on);
    setReadingFromDefault(client.readingFromDefault);
    setRpcFailing(false);
  }, [client]);

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
    ase1Address: address ? toAse1(address) : null,
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
    rpcState: {
      rpc: rpcOverride || client.defaultRpc,
      defaultRpc: client.defaultRpc,
      isCustom: rpcOverride != null,
      allowed: allowCustomRpc,
      failing: rpcFailing,
      readingFromDefault,
    },
    setRpc,
    resetRpc,
    readFromDefault,
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

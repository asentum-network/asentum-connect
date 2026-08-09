import React, { useState } from 'react';
import { useAsentumContext } from './context';
import { ConnectModal } from './ConnectModal';
import { shortAddress } from './client';

export interface ConnectButtonProps {
  text?: string;      // label when disconnected, default "Connect Wallet"
  bg?: string;
  color?: string;
  border?: string;
  radius?: number;
  menu?: boolean;     // copy/disconnect menu when connected, default true
  className?: string;
  style?: React.CSSProperties;
}

export function ConnectButton({
  text = 'Connect Wallet', bg, color = '#fff', border = 'none', radius = 12, menu = true, className, style,
}: ConnectButtonProps) {
  const c = useAsentumContext();
  const [open, setOpen] = useState(false);

  const base: React.CSSProperties = {
    background: bg || 'linear-gradient(135deg,#7c5cff,#9d7bff)',
    color, border, borderRadius: radius, padding: '10px 18px', fontWeight: 600, fontSize: 14,
    cursor: 'pointer', fontFamily: 'inherit', position: 'relative', ...style,
  };

  if (!c.connected) {
    return (
      <>
        <button className={className} style={base}
          onClick={() => (c.hasWallet || c.telegramBot || c.onCreateWallet ? c._openModal() : c.connect())}
          disabled={c.connecting}>
          {c.connecting ? 'Connecting…' : text}
        </button>
        <ConnectModal />
      </>
    );
  }

  const label = shortAddress(c.address);
  if (!menu) {
    return <button className={className} style={base} onClick={() => c.disconnect()}>{label}</button>;
  }
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button className={className} style={base} onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open && (
        <div style={M.menu} onMouseLeave={() => setOpen(false)}>
          <button style={M.item} onClick={() => { navigator.clipboard?.writeText(c.address || ''); setOpen(false); }}>Copy address</button>
          <button style={{ ...M.item, color: '#ff9db0' }} onClick={() => { c.disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      )}
    </span>
  );
}

const M: Record<string, React.CSSProperties> = {
  menu: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 999, minWidth: 160,
    background: '#0b0b0e', border: '1px solid #232323', borderRadius: 10, overflow: 'hidden',
    boxShadow: '0 10px 30px rgba(0,0,0,.5)' },
  item: { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
    color: '#e9e9ee', padding: '10px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
};

import React from 'react';
import { useAsentumContext } from './context';

export function ConnectModal() {
  const c = useAsentumContext();
  if (!c._modalOpen) return null;

  const options: { key: string; title: string; sub: string; cta: string; onClick: () => void }[] = [];

  // extension: always shown, links to install if missing
  options.push({
    key: 'extension',
    title: c.hasWallet ? 'Browser extension' : 'Install the Asentum extension',
    sub: c.hasWallet ? 'Use the wallet you already have installed' : 'Get the extension, then reconnect',
    cta: c.hasWallet ? 'Connect' : 'Get it',
    onClick: () => {
      if (c.hasWallet) c.connect();
      else window.open('https://www.asentum.com/download', '_blank', 'noopener');
    },
  });

  if (c.telegramBot) {
    options.push({
      key: 'telegram',
      title: 'Telegram bot',
      sub: `Opens @${c.telegramBot} to link your wallet`,
      cta: 'Open',
      onClick: () => window.open(`https://t.me/${c.telegramBot}?start=link`, '_blank', 'noopener'),
    });
  }

  if (c.onCreateWallet) {
    options.push({
      key: 'create',
      title: 'Create a new wallet',
      sub: 'Generated in your browser, keystore download',
      cta: 'Create',
      onClick: () => { c.onCreateWallet?.(); },
    });
  }

  return (
    <div style={S.overlay} onClick={c._closeModal}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.eyebrow}>· Connect wallet</div>
            <div style={S.title}>Connect to Asentum</div>
          </div>
          <button aria-label="close" style={S.close} onClick={c._closeModal}>✕</button>
        </div>

        <div style={S.body}>
          {options.map((o) => (
            <button key={o.key} style={S.option} onClick={o.onClick}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#232323')}>
              <div style={S.optText}>
                <div style={S.optTitle}>{o.title}</div>
                <div style={S.optSub}>{o.sub}</div>
              </div>
              <span style={S.optCta}>{o.cta}</span>
            </button>
          ))}
          {c.error && <div style={S.err}>{c.error}</div>}
        </div>

        <div style={S.foot}>We only read on-chain activity and request signatures — never custody your keys.</div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.72)',
    backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { width: '100%', maxWidth: 400, background: '#0b0b0e', border: '1px solid #232323', borderRadius: 16,
    color: '#e9e9ee', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif', overflow: 'hidden' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 18px 14px', borderBottom: '1px solid #1c1c1c' },
  eyebrow: { fontSize: 10, letterSpacing: '.15em', textTransform: 'uppercase', color: '#6a6a72', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: 600 },
  close: { background: 'transparent', border: '1px solid #232323', color: '#9a9aa2', width: 30, height: 30, borderRadius: 8, cursor: 'pointer' },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  option: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
    background: '#111114', border: '1px solid #232323', borderRadius: 12, padding: '14px 16px', color: 'inherit', transition: 'border-color .15s' },
  optText: { flex: 1 },
  optTitle: { fontSize: 14, fontWeight: 600 },
  optSub: { fontSize: 12, color: '#8a8a92', marginTop: 3 },
  optCta: { fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#b7a8ff', fontWeight: 700 },
  err: { fontSize: 12, color: '#ff9db0', padding: '4px 2px' },
  foot: { padding: '12px 16px', borderTop: '1px solid #1c1c1c', fontSize: 11, color: '#6a6a72', background: '#060608' },
};

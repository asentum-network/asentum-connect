import React, { useEffect, useRef, useState } from 'react';
import { useAsentumContext } from './context';

export function ConnectModal() {
  const c = useAsentumContext();
  const [view, setView] = useState<'options' | 'code'>('options');
  const [code, setCode] = useState('------');
  const [ttl, setTtl] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttlRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (ttlRef.current) clearInterval(ttlRef.current);
    pollRef.current = null;
    ttlRef.current = null;
  };
  useEffect(() => () => stopTimers(), []);

  const close = () => { stopTimers(); setView('options'); c._setError(null); c._closeModal(); };

  // ── Telegram code flow: create session, show code, poll for approval ──
  async function startCode() {
    setView('code');
    c._setError(null);
    setCode('------');
    setTtl('');
    try {
      const data = await c.client.createBotSession(c.dappName);
      setCode(data.code);
      const expires = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 5 * 60_000;
      const tick = () => {
        const ms = expires - Date.now();
        if (ms <= 0) { stopTimers(); setTtl('expired'); c._setError('Code expired. Go back and try again.'); return; }
        const s = Math.floor(ms / 1000);
        setTtl(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      };
      tick();
      ttlRef.current = setInterval(tick, 1000);
      pollRef.current = setInterval(async () => {
        try {
          const s = await c.client.getBotSessionStatus(data.sessionId);
          if (s.status === 'connected' && s.address) {
            stopTimers();
            c._connectBot({ address: s.address, sessionId: data.sessionId });
            setView('options');
          } else if (s.status === 'rejected') { stopTimers(); c._setError('Connection rejected in the wallet.'); }
          else if (s.status === 'expired') { stopTimers(); c._setError('Session expired. Try again.'); }
        } catch { /* transient — keep polling */ }
      }, 2000);
    } catch (e: any) {
      c._setError(e?.message || 'Could not start pairing.');
    }
  }

  if (!c._modalOpen) return null;

  const options: { key: string; title: string; sub: string; cta: string; onClick: () => void; disabled?: boolean; chip?: string }[] = [];
  if (c.extensionStatus === 'soon') {
    options.push({
      key: 'extension',
      title: 'Browser extension',
      sub: 'Connect with the Asentum extension once it ships',
      cta: 'Connect',
      onClick: () => {},
      disabled: true,
      chip: 'Soon',
    });
  } else {
    options.push({
      key: 'extension',
      title: c.hasWallet ? 'Browser extension' : 'Install the browser extension',
      sub: c.hasWallet ? 'Use the wallet you already have installed' : 'Get the extension, then reconnect',
      cta: c.hasWallet ? 'Connect' : 'Get it',
      onClick: () => { if (c.hasWallet) c.connect(); else window.open('https://www.asentum.com/download', '_blank', 'noopener'); },
    });
  }
  if (c.telegramBot) {
    options.push({
      key: 'telegram',
      title: 'Telegram wallet',
      sub: 'Pair with a 6-digit code, no app switch',
      cta: 'Pair',
      onClick: startCode,
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
    <div style={S.overlay} onClick={close}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.eyebrow}>· Connect wallet</div>
            <div style={S.title}>{view === 'code' ? 'Pair Telegram wallet' : 'Connect to Asentum'}</div>
          </div>
          <button aria-label="close" style={S.close} onClick={close}>✕</button>
        </div>

        {view === 'options' ? (
          <div style={S.body}>
            {options.map((o) => (
              <button key={o.key} style={o.disabled ? S.optionDisabled : S.option} onClick={o.onClick}
                disabled={o.disabled} aria-disabled={o.disabled}
                onMouseEnter={(e) => { if (!o.disabled) e.currentTarget.style.borderColor = '#3a3a3a'; }}
                onMouseLeave={(e) => { if (!o.disabled) e.currentTarget.style.borderColor = '#232323'; }}>
                <div style={S.optText}>
                  <div style={S.optTitleRow}>
                    <span style={S.optTitle}>{o.title}</span>
                    {o.chip && <span style={S.chip}>{o.chip}</span>}
                  </div>
                  <div style={S.optSub}>{o.sub}</div>
                </div>
                <span style={o.disabled ? S.optCtaDisabled : S.optCta}>{o.cta}</span>
              </button>
            ))}
            {c.error && <div style={S.err}>{c.error}</div>}
          </div>
        ) : (
          <div style={S.body}>
            <div style={S.steps}>
              Open <b>@{c.telegramBot}</b> in Telegram → tap <b>Connect wallet</b> → enter this code:
            </div>
            <div style={S.code}>{code.split('').map((ch, i) => <span key={i} style={S.digit}>{ch}</span>)}</div>
            <div style={S.ttl}>{ttl === 'expired' ? 'Expired' : ttl ? `Expires in ${ttl}` : 'Waiting for wallet…'}</div>
            {c.telegramBot && (
              <a href={`https://t.me/${c.telegramBot}`} target="_blank" rel="noopener noreferrer" style={S.tgOpen}>
                Open @{c.telegramBot} ↗
              </a>
            )}
            {c.error && <div style={S.err}>{c.error}</div>}
            <button style={S.back} onClick={() => { stopTimers(); c._setError(null); setView('options'); }}>← Back</button>
          </div>
        )}

        <div style={S.foot}>We only read on-chain activity and request signatures. We never custody your keys.</div>
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
  optionDisabled: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'not-allowed',
    background: '#0e0e11', border: '1px dashed #232323', borderRadius: 12, padding: '14px 16px', color: 'inherit', opacity: 0.6 },
  optText: { flex: 1 },
  optTitleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  optTitle: { fontSize: 14, fontWeight: 600 },
  chip: { fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: '#b7a8ff',
    background: '#1a1626', border: '1px solid #2a2440', borderRadius: 999, padding: '2px 8px', lineHeight: 1.4 },
  optSub: { fontSize: 12, color: '#8a8a92', marginTop: 3 },
  optCta: { fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#b7a8ff', fontWeight: 700 },
  optCtaDisabled: { fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#55555e', fontWeight: 700 },
  err: { fontSize: 12, color: '#ff9db0', padding: '4px 2px' },
  steps: { fontSize: 13, color: '#b7b7bf', lineHeight: 1.5, textAlign: 'center' },
  code: { display: 'flex', justifyContent: 'center', gap: 8, margin: '6px 0' },
  digit: { width: 40, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700,
    fontVariantNumeric: 'tabular-nums', background: '#111114', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff' },
  ttl: { fontSize: 12, color: '#8a8a92', textAlign: 'center' },
  tgOpen: { display: 'block', textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: '#b7a8ff', textDecoration: 'none',
    border: '1px solid #2a2440', background: '#14121f', borderRadius: 10, padding: '10px 12px', marginTop: 2 },
  back: { background: 'transparent', border: '1px solid #232323', color: '#9a9aa2', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-start' },
  foot: { padding: '12px 16px', borderTop: '1px solid #1c1c1c', fontSize: 11, color: '#6a6a72', background: '#060608' },
};

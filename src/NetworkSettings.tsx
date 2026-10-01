import React, { useEffect, useState } from 'react';
import { useAsentumContext } from './context';
import { formatHeight, rpcHost } from './rpc-validation';

export interface NetworkSettingsProps {
  // called with true while the inline editor is open (so a menu can stay open)
  onEditingChange?: (editing: boolean) => void;
  compact?: boolean;
}

// "Network" row: shows the RPC host, a Change action with an inline input,
// Save (checks the node first) and Reset to default. Also carries the
// non-blocking notice when the user's own RPC stops answering.
export function NetworkSettings({ onEditingChange, compact }: NetworkSettingsProps) {
  const c = useAsentumContext();
  const r = c.rpcState;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; checks?: string[]; note?: string } | null>(null);

  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

  if (!r.allowed) {
    return (
      <div style={N.row}>
        <div style={N.label}>Network</div>
        <div style={N.host} title={r.rpc}>{rpcHost(r.rpc)}</div>
      </div>
    );
  }

  const open = () => { setValue(r.isCustom ? r.rpc : ''); setMsg(null); setEditing(true); };
  const save = async () => {
    if (busy) return;
    if (!value.trim()) { setMsg({ kind: 'err', text: 'Enter the address of your node, or use Reset to default.' }); return; }
    setBusy(true);
    setMsg({ kind: 'info', text: 'Checking the node…' });
    try {
      const res = await c.setRpc(value);
      if (res.ok && res.height != null) {
        setMsg({ kind: 'ok', text: `Connected: block ${formatHeight(res.height)}`, checks: res.checks, note: res.note });
        setEditing(false);
      } else {
        setMsg({ kind: 'err', text: `Not saved. ${res.error || ''}`.trim(), checks: res.checks, note: res.note });
      }
    } finally {
      setBusy(false);
    }
  };
  const reset = () => { c.resetRpc(); setEditing(false); setMsg({ kind: 'info', text: 'Using the default RPC.' }); };

  return (
    <div style={compact ? N.rowCompact : N.row} onClick={(e) => e.stopPropagation()}>
      <div style={N.head}>
        <div style={N.label}>Network</div>
        <div style={N.host} title={r.rpc}>
          {rpcHost(r.rpc)}{r.isCustom && <span style={N.tag}>Custom</span>}
        </div>
        {!editing && <button type="button" style={N.link} onClick={open}>Change</button>}
      </div>

      {r.isCustom && r.failing && !r.readingFromDefault && (
        <div style={N.warn}>
          Your custom RPC is not answering. Switch back to the default?
          <div style={N.btnRow}>
            <button type="button" style={N.btn} onClick={reset}>Switch to default</button>
            <button type="button" style={N.btn} onClick={() => c.readFromDefault(true)}>Read from default for now</button>
          </div>
        </div>
      )}
      {r.isCustom && r.readingFromDefault && (
        <div style={N.warn}>
          Reading from the default RPC for now.
          <div style={N.btnRow}>
            <button type="button" style={N.btn} onClick={reset}>Switch to default</button>
            <button type="button" style={N.btn} onClick={() => c.readFromDefault(false)}>Use my RPC again</button>
          </div>
        </div>
      )}

      {editing && (
        <div style={N.editor}>
          <input
            style={N.input} type="url" value={value} placeholder="https://your-node.example.com"
            autoComplete="off" spellCheck={false} autoFocus disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <div style={N.btnRow}>
            <button type="button" style={N.btnPrimary} onClick={save} disabled={busy}>{busy ? 'Checking…' : 'Save'}</button>
            <button type="button" style={N.btn} onClick={reset} disabled={busy}>Reset to default</button>
            <button type="button" style={N.btnGhost} onClick={() => { setEditing(false); setMsg(null); }} disabled={busy}>Cancel</button>
          </div>
          <div style={N.hint}>Reads from this app use your node. The browser extension has its own RPC setting.</div>
        </div>
      )}
      {!editing && r.isCustom && !msg && (
        <button type="button" style={{ ...N.link, marginTop: 4 }} onClick={reset}>Reset to default</button>
      )}

      {msg && (
        <div style={msg.kind === 'err' ? N.err : msg.kind === 'ok' ? N.ok : N.info}>
          {msg.text}
          {msg.checks && msg.checks.length > 0 && (
            <ul style={N.checks}>{msg.checks.map((ch) => <li key={ch}>{ch}</li>)}</ul>
          )}
          {msg.note && <div style={N.note}>{msg.note}</div>}
        </div>
      )}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.3,
};
const N: Record<string, React.CSSProperties> = {
  row: { padding: '10px 14px', borderTop: '1px solid #1c1c1c', color: '#e9e9ee', fontSize: 12 },
  rowCompact: { padding: '10px 16px', borderTop: '1px solid #1c1c1c', color: '#e9e9ee', fontSize: 12, background: '#060608' },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6a6a72' },
  host: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#b7b7bf',
    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 11.5 },
  tag: { marginLeft: 6, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#b7a8ff',
    border: '1px solid #2a2440', borderRadius: 999, padding: '1px 6px', fontFamily: 'inherit' },
  link: { background: 'transparent', border: 'none', color: '#b7a8ff', cursor: 'pointer', fontSize: 12, padding: 0,
    fontFamily: 'inherit', fontWeight: 600 },
  editor: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  input: { width: '100%', boxSizing: 'border-box', background: '#111114', border: '1px solid #2a2a2a', borderRadius: 8,
    color: '#e9e9ee', padding: '8px 10px', fontSize: 12, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', outline: 'none' },
  btnRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  btnPrimary: { ...btnBase, background: '#7c5cff', border: '1px solid #7c5cff', color: '#fff', fontWeight: 600 },
  btn: { ...btnBase, background: '#111114', border: '1px solid #2a2a2a', color: '#e9e9ee' },
  btnGhost: { ...btnBase, background: 'transparent', border: '1px solid transparent', color: '#8a8a92' },
  hint: { fontSize: 11, color: '#6a6a72', lineHeight: 1.4 },
  warn: { marginTop: 8, fontSize: 12, color: '#f2b36f', background: '#1d150b', border: '1px solid #3a2a14',
    borderRadius: 8, padding: '8px 10px', lineHeight: 1.4 },
  err: { marginTop: 6, fontSize: 12, color: '#ff9db0', lineHeight: 1.4 },
  ok: { marginTop: 6, fontSize: 12, color: '#7fd4a8', lineHeight: 1.4 },
  info: { marginTop: 6, fontSize: 12, color: '#8a8a92', lineHeight: 1.4 },
  checks: { margin: '4px 0 0', paddingLeft: 16, color: '#8a8a92' },
  note: { marginTop: 4, color: '#f2b36f' },
};

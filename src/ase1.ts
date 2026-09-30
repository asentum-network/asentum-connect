// ase1 address helpers (bech32, HRP "ase", 20-byte payload).
// Everything the kit shows a user is ase1. Hex stays internal for RPC calls.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HRP = 'ase';

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GENERATOR[i];
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >> from !== 0) return null;
    acc = ((acc << from) | value) & maxAcc;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return ret;
}

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** True for a well-formed ase1 address with a valid checksum. */
export function isAse1(s?: string | null): boolean {
  return !!s && ase1ToHex(s) !== null;
}

/** 0x hex (20 bytes) to ase1. Returns '' when the input is not a hex address. */
export function hexToAse1(hex?: string | null): string {
  if (!hex || !HEX_ADDR.test(hex)) return '';
  const bytes: number[] = [];
  for (let i = 2; i < 42; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const data = convertBits(bytes, 8, 5, true)!;
  const values = hrpExpand(HRP).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  let out = `${HRP}1`;
  for (const d of data) out += CHARSET.charAt(d);
  for (let p = 0; p < 6; p++) out += CHARSET.charAt((mod >> (5 * (5 - p))) & 31);
  return out;
}

/** ase1 to lowercase 0x hex, or null when the checksum or length is wrong. */
export function ase1ToHex(addr?: string | null): string | null {
  if (!addr) return null;
  const s = addr.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null;
  const lower = s.toLowerCase();
  if (!lower.startsWith(`${HRP}1`)) return null;
  const data: number[] = [];
  for (const ch of lower.slice(HRP.length + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return null;
    data.push(v);
  }
  if (data.length < 6) return null;
  if (polymod(hrpExpand(HRP).concat(data)) !== 1) return null;
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (!bytes || bytes.length !== 20) return null;
  return '0x' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Any address (hex or ase1) to ase1 for display. Unknown input is returned unchanged. */
export function toAse1(a?: string | null): string {
  if (!a) return '';
  const s = String(a).trim();
  if (HEX_ADDR.test(s)) return hexToAse1(s);
  if (isAse1(s)) return s.toLowerCase();
  return s;
}

/** Shortened ase1 for buttons and chips, e.g. ase1qxyz12…ab34cd. */
export function shortAse1(a?: string | null, lead = 10, tail = 6): string {
  const s = toAse1(a);
  return s.length > lead + tail ? `${s.slice(0, lead)}…${s.slice(-tail)}` : s;
}

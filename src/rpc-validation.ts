// Custom RPC validation for @asentum/connect.
// Kept in step with the Asentum Wallet extension (packages/extension/src/rpc-settings.ts).

/**
 * Custom RPC URL normalisation and validation.
 *
 * The same rules live in the Asentum Wallet extension (src/rpc-settings.ts);
 * keep the two copies in step. Everything here is pure apart from
 * `validateRpc`, which takes an injectable fetch so it can be tested.
 *
 * A custom RPC is accepted only if:
 *   1. it parses as an http: or https: URL (https strongly recommended; plain
 *      http only for localhost, 127.0.0.1 or a private LAN address),
 *   2. GET <url>/metadata answers within the timeout with chainIdDecimal
 *      "1423" or chainId "0x58f",
 *   3. GET <url>/v3/heads answers with a numeric finalized height.
 */

export const DEFAULT_RPC_URL = 'https://testnet.asentum.com';
export const EXPECTED_CHAIN_ID_DECIMAL = '1423';
export const EXPECTED_CHAIN_ID_HEX = '0x58f';
export const RPC_CHECK_TIMEOUT_MS = 5000;

export interface NormalizeOptions {
  /**
   * Allow plain http to private LAN addresses (10/8, 172.16/12, 192.168/16,
   * 169.254/16, fc00::/7). Default true. The extension turns this off because
   * Chrome cannot grant it host access to arbitrary LAN IPs.
   */
  allowLanHttp?: boolean;
}

export type NormalizeResult =
  | {
      ok: true;
      /** Normalised URL: no trailing slash, no query or fragment. */
      url: string;
      /** e.g. "https://rpc.example.com:8545" */
      origin: string;
      /** Host for display, e.g. "rpc.example.com:8545" */
      host: string;
      /** True when the URL uses plain http. */
      insecure: boolean;
      /** Plain-English note to show the user, if any. */
      note?: string;
    }
  | { ok: false; error: string };

/** Strip whitespace and trailing slashes. */
export function stripTrailingSlashes(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function isPrivateLanHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // IPv6 unique local addresses (fc00::/7).
  return /^f[cd][0-9a-f]{0,2}:/.test(h);
}

/** True for localhost / loopback / private LAN hosts. */
export function isLocalHost(hostname: string): boolean {
  return isLoopbackHost(hostname) || isPrivateLanHost(hostname);
}

/**
 * Parse and normalise a user-entered RPC URL. A bare host like
 * "rpc.example.com" is treated as https.
 */
export function normalizeRpcUrl(input: string, opts: NormalizeOptions = {}): NormalizeResult {
  const allowLanHttp = opts.allowLanHttp ?? true;
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter an RPC address.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: 'That does not look like a web address.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'The address must start with https:// (or http:// for a node on your own machine).' };
  }
  if (!parsed.hostname) return { ok: false, error: 'The address is missing a host name.' };
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Please remove the user name and password from the address.' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: 'Please remove the part after ? or # from the address.' };
  }

  const insecure = parsed.protocol === 'http:';
  let note: string | undefined;
  if (insecure) {
    if (isLoopbackHost(parsed.hostname)) {
      note = 'Plain http is fine for a node on this computer. Use https for anything else.';
    } else if (isPrivateLanHost(parsed.hostname)) {
      if (!allowLanHttp) {
        return {
          ok: false,
          error: 'Plain http only works for a node on this computer (localhost). Put your node behind https to use it here.',
        };
      }
      note = 'Plain http only works on your local network, and pages served over https cannot reach it. Use https if you can.';
    } else {
      return { ok: false, error: 'Use https:// for this address. Plain http is only allowed for a node on your own machine or local network.' };
    }
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const url = `${parsed.protocol}//${parsed.host}${path}`;
  return { ok: true, url, origin: `${parsed.protocol}//${parsed.host}`, host: parsed.host, insecure, note };
}

/** Same URL once normalised (used to tell whether a URL is the default). */
export function sameRpcUrl(a: string, b: string): boolean {
  const na = normalizeRpcUrl(a);
  const nb = normalizeRpcUrl(b);
  if (na.ok && nb.ok) return na.url.toLowerCase() === nb.url.toLowerCase();
  return stripTrailingSlashes(a).toLowerCase() === stripTrailingSlashes(b).toLowerCase();
}

/** Host part of an RPC URL for display. Falls back to the raw string. */
export function rpcHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** True when GET /metadata says this node is on chain 1423. */
export function metadataMatchesChain(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as { chainIdDecimal?: unknown; chainId?: unknown };
  if (m.chainIdDecimal != null && String(m.chainIdDecimal) === EXPECTED_CHAIN_ID_DECIMAL) return true;
  if (typeof m.chainId === 'string' && m.chainId.toLowerCase() === EXPECTED_CHAIN_ID_HEX) return true;
  if (typeof m.chainId === 'number' && String(m.chainId) === EXPECTED_CHAIN_ID_DECIMAL) return true;
  return false;
}

/** Chain id reported by /metadata, for an error message. */
export function metadataChainLabel(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return 'unknown';
  const m = meta as { chainIdDecimal?: unknown; chainId?: unknown };
  if (m.chainIdDecimal != null) return String(m.chainIdDecimal);
  if (m.chainId != null) {
    const s = String(m.chainId);
    if (/^0x[0-9a-f]+$/i.test(s)) {
      try {
        return BigInt(s).toString();
      } catch {
        return s;
      }
    }
    return s;
  }
  return 'unknown';
}

/** Finalized height from GET /v3/heads, or null when it is not numeric. */
export function parseFinalizedHeight(heads: unknown): number | null {
  if (!heads || typeof heads !== 'object') return null;
  const f = (heads as { finalized?: unknown }).finalized;
  if (typeof f === 'number' && Number.isFinite(f) && f >= 0) return Math.floor(f);
  if (typeof f === 'string' && /^\d+$/.test(f.trim())) return Number(f.trim());
  return null;
}

/** 309120 -> "309,120" */
export function formatHeight(height: number): string {
  return String(Math.floor(height)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** True when an error looks like the node did not answer at all. */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'TypeError' || e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  const msg = String(e.message ?? err).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed')
  );
}

export interface RpcCheckResult {
  ok: boolean;
  /** Normalised URL (when it parsed). */
  url?: string;
  /** Finalized block height reported by the node. */
  height?: number;
  /** Plain-English list of what was checked, in order. */
  checks: string[];
  /** Note about plain http, when relevant. */
  note?: string;
  /** Plain-English reason the RPC was not accepted. */
  error?: string;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(url, { signal: controller?.signal, headers: { Accept: 'application/json' } }),
      timeout,
    ]);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { name: 'HttpError' });
    return await Promise.race([res.json(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeFailure(err: unknown, what: string, timeoutMs: number): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${what} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`;
  if (e?.name === 'HttpError') return `${what} answered with an error (${e.message}).`;
  if (e instanceof SyntaxError) return `${what} did not return valid data. Is this an Asentum node RPC?`;
  return `${what} could not be reached. Check the address, and that the node allows requests from browsers (CORS).`;
}

/**
 * Run the full check against a candidate RPC URL. Never throws.
 */
export async function validateRpc(
  input: string,
  opts: NormalizeOptions & { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<RpcCheckResult> {
  const checks: string[] = [];
  const norm = normalizeRpcUrl(input, opts);
  if (!norm.ok) return { ok: false, checks, error: norm.error };
  checks.push(norm.insecure ? 'Address uses plain http' : 'Address uses https');

  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as unknown as FetchLike | undefined);
  if (!fetchImpl) return { ok: false, url: norm.url, checks, note: norm.note, error: 'This browser cannot make network requests.' };
  const timeoutMs = opts.timeoutMs ?? RPC_CHECK_TIMEOUT_MS;

  let meta: unknown;
  try {
    meta = await getJson(fetchImpl, `${norm.url}/metadata`, timeoutMs);
  } catch (err) {
    return { ok: false, url: norm.url, checks, note: norm.note, error: describeFailure(err, 'The node', timeoutMs) };
  }
  if (!metadataMatchesChain(meta)) {
    return {
      ok: false,
      url: norm.url,
      checks,
      note: norm.note,
      error: `This node is on chain ${metadataChainLabel(meta)}, not the Asentum testnet (chain ${EXPECTED_CHAIN_ID_DECIMAL}).`,
    };
  }
  checks.push(`Node is on chain ${EXPECTED_CHAIN_ID_DECIMAL}`);

  let heads: unknown;
  try {
    heads = await getJson(fetchImpl, `${norm.url}/v3/heads`, timeoutMs);
  } catch (err) {
    return { ok: false, url: norm.url, checks, note: norm.note, error: describeFailure(err, 'The block height check (/v3/heads)', timeoutMs) };
  }
  const height = parseFinalizedHeight(heads);
  if (height == null) {
    return { ok: false, url: norm.url, checks, note: norm.note, error: 'The node did not report a finalized block height.' };
  }
  checks.push(`Finalized block ${formatHeight(height)}`);

  return { ok: true, url: norm.url, height, checks, note: norm.note };
}

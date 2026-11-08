import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsentumClient, BOT_SIGN_POLL_MS, BOT_SIGN_TIMEOUT_MS } from '../src/client';

type Answer = { status: number; body?: unknown } | Error;

/** Mock fetch: POST sign-request returns a request id; each poll takes the next answer (the last repeats). */
function installFetch(answers: Answer[]) {
  const polls: string[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ requestId: 'req1' }), text: async () => '' } as unknown as Response;
    }
    polls.push(url);
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as unknown as Response;
  }) as typeof fetch;
  return polls;
}

function botClient() {
  const c = new AsentumClient({ botApi: 'https://bot.test' });
  c.useBotSession('sess1');
  return c as unknown as { botSign: (p: Record<string, unknown>) => Promise<any> };
}

describe('botSign polling', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  it('resolves on approved and stops polling', async () => {
    const polls = installFetch([{ status: 200, body: { status: 'pending' } }, { status: 200, body: { status: 'approved', txHash: '0xabc' } }]);
    const p = botClient().botSign({ type: 'transfer' });
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS * 2);
    await expect(p).resolves.toMatchObject({ txHash: '0xabc' });
    expect(vi.getTimerCount()).toBe(0);
    const n = polls.length;
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS * 5);
    expect(polls.length).toBe(n);
  });

  it('rejects on rejected and on expired, clearing the interval', async () => {
    installFetch([{ status: 200, body: { status: 'rejected', error: 'no thanks' } }]);
    const p1 = botClient().botSign({ type: 'transfer' });
    p1.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS);
    await expect(p1).rejects.toThrow('no thanks');
    expect(vi.getTimerCount()).toBe(0);

    installFetch([{ status: 200, body: { status: 'expired' } }]);
    const p2 = botClient().botSign({ type: 'transfer' });
    p2.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS);
    await expect(p2).rejects.toThrow(/expired/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([404, 410])('rejects on HTTP %i (request or session gone) and stops', async (status) => {
    const polls = installFetch([{ status }]);
    const p = botClient().botSign({ type: 'transfer' });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS);
    await expect(p).rejects.toThrow(/no longer exists/);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS * 5);
    expect(polls.length).toBe(1);
  });

  it('keeps polling through 5xx and network errors, then gives up after 5 minutes', async () => {
    const polls = installFetch([{ status: 502 }, new TypeError('Failed to fetch'), { status: 503 }]);
    const p = botClient().botSign({ type: 'transfer' });
    let settled = false;
    p.catch(() => undefined).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS * 10);
    expect(settled).toBe(false);
    expect(polls.length).toBe(10);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_TIMEOUT_MS);
    await expect(p).rejects.toThrow('Request expired after 5 minutes');
    expect(vi.getTimerCount()).toBe(0);
    const n = polls.length;
    await vi.advanceTimersByTimeAsync(BOT_SIGN_POLL_MS * 5);
    expect(polls.length).toBe(n);
  });

  it('a non-terminal status (pending forever) also ends at the deadline', async () => {
    installFetch([{ status: 200, body: { status: 'pending' } }]);
    const p = botClient().botSign({ type: 'transfer' });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_TIMEOUT_MS + BOT_SIGN_POLL_MS);
    await expect(p).rejects.toThrow(/expired/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hung poll does not stack requests and the deadline still fires', async () => {
    const polls: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ requestId: 'r' }) } as unknown as Response;
      polls.push(url);
      return new Promise(() => undefined); // never answers
    }) as typeof fetch;
    const p = botClient().botSign({ type: 'transfer' });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(BOT_SIGN_TIMEOUT_MS + BOT_SIGN_POLL_MS);
    await expect(p).rejects.toThrow(/expired/);
    expect(polls.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

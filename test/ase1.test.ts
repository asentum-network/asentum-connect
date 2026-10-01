import { describe, expect, it } from 'vitest';
import { ase1ArgsToHex, ase1ToHex } from '../src/ase1';
import { AsentumClient } from '../src/client';

// Known pair from the explorer.
const ASE1 = 'ase1wtc569gfwk87hplaawr46uj4suwsx2wndgf8ue';
const HEX = '0x72f14d1509758feb87fdeb875d7255871d0329d3';
const BAD_CHECKSUM = 'ase1wtc569gfwk87hplaawr46uj4suwsx2wndgf8uf';

describe('ase1ArgsToHex', () => {
  it('converts valid and uppercase ase1', () => {
    expect(ase1ToHex(ASE1)).toBe(HEX);
    expect(ase1ArgsToHex([ASE1, ASE1.toUpperCase()])).toEqual([HEX, HEX]);
  });
  it('leaves bad checksum, padded, other strings, numbers and hex untouched', () => {
    const input = [BAD_CHECKSUM, ` ${ASE1}`, `${ASE1}\n`, 'hello', '1000', 5, null, HEX];
    expect(ase1ArgsToHex(input)).toEqual(input);
  });
  it('walks nested arrays and objects, values only, without mutating', () => {
    const input = [{ owner: ASE1, list: [ASE1, { deep: ASE1 }], [ASE1]: 1 }, [[ASE1]]];
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(ase1ArgsToHex(input)).toEqual([{ owner: HEX, list: [HEX, { deep: HEX }], [ASE1]: 1 }, [[HEX]]]);
    expect(input).toEqual(snapshot);
  });
});

describe('AsentumClient', () => {
  it('call() hands the extension hex args and target', async () => {
    let got: any;
    (globalThis as any).window = {
      asentum: { callContract: async (p: unknown) => { got = p; return { txHash: '0xabc' }; } },
    };
    try {
      const c = new AsentumClient({} as any);
      const args = [ASE1, '5', { to: ASE1 }];
      await c.call(ASE1, 'transfer', args);
      expect(got).toEqual({ to: HEX, method: 'transfer', args: [HEX, '5', { to: HEX }], value: '0' });
      expect(args[0]).toBe(ASE1);
    } finally {
      delete (globalThis as any).window;
    }
  });
  it('view() posts hex args', async () => {
    const orig = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ ok: true, returnValue: '1' }) };
    }) as any;
    try {
      await new AsentumClient({} as any).view(ASE1, 'balanceOf', [ASE1]);
    } finally {
      globalThis.fetch = orig;
    }
    expect(sent).toEqual({ contract: HEX, method: 'balanceOf', args: [HEX] });
  });
});

// Native @usernames (node 0.9.0, live from the names flag day: block
// 1,200,000 on chain 1423). A name points at an address; the address stays
// the account. Resolve when you build a transaction and show both.
//
// Rules (same as the registry contract and @asentum/sdk): 3-24 characters,
// a-z 0-9 and hyphens, no hyphen at either end, no double hyphen, ASCII
// only, not shaped like an address. Input is case-insensitive and may start
// with one @.

import { hexToAse1 } from './ase1';

/** The NameRegistry system contract (0x...0b), as hex for calls. */
export const NAME_REGISTRY_HEX = '0x000000000000000000000000000000000000000b';
/** The same address as ase1, for display. */
export const NAME_REGISTRY_CONTRACT: string = hexToAse1(NAME_REGISTRY_HEX) as string;
/** Gas limit that comfortably covers register (about 136k first name, 81k later). */
export const NAME_REGISTER_GAS = 300_000;

/** Fee in ASE by name length. */
export const NAME_FEES_ASE = Object.freeze({ 3: 500, 4: 100, 5: 50, long: 10 });

export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s.startsWith('@')) s = s.slice(1);
  if (!/^[\x21-\x7e]*$/.test(s)) return null;
  s = s.toLowerCase();
  if (s.length < 3 || s.length > 24) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(s)) return null;
  if (s.includes('--')) return null;
  if (s.startsWith('0x') || s.startsWith('ase1')) return null;
  return s;
}

/** True for "@name" input (the @ tells a name from an address in a "to" field). */
export function isNameInput(input: unknown): boolean {
  return typeof input === 'string' && input.trim().startsWith('@') && normalizeName(input) !== null;
}

/** "milkie" -> "@milkie" for display. */
export function formatName(name: string): string {
  const n = normalizeName(name);
  return n === null ? name : '@' + n;
}

/** Registration fee in ASE for a valid name, or null. */
export function nameFeeAse(name: string): number | null {
  const n = normalizeName(name);
  if (n === null) return null;
  return n.length === 3 ? NAME_FEES_ASE[3] : n.length === 4 ? NAME_FEES_ASE[4] : n.length === 5 ? NAME_FEES_ASE[5] : NAME_FEES_ASE.long;
}

/** Registration fee in wei (decimal string, the exact value register wants). */
export function nameFeeWei(name: string): string | null {
  const ase = nameFeeAse(name);
  return ase === null ? null : ase.toString() + '000000000000000000';
}

/** The node has no name registry yet (before the flag day, or a node older than 0.9.0). */
export class NamesNotActiveError extends Error {
  readonly activatesAt: number | null;
  constructor(activatesAt: number | null = null) {
    super(activatesAt != null
      ? `Usernames are not live yet (from block ${activatesAt.toLocaleString('en-US')}).`
      : 'Usernames are not live on this network yet.');
    this.name = 'NamesNotActiveError';
    this.activatesAt = activatesAt;
  }
}

/** The name is valid but nobody owns it. */
export class NameNotFoundError extends Error {
  readonly nameValue: string;
  constructor(name: string) {
    super(`@${name} is not registered. Check the spelling, or send to an ase1 address.`);
    this.name = 'NameNotFoundError';
    this.nameValue = name;
  }
}

export class InvalidNameError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid name: 3-24 characters, a-z 0-9 and hyphens.`);
    this.name = 'InvalidNameError';
  }
}

/** Result of resolveRecipient: what to send to, and what to show. */
export interface ResolvedRecipient {
  /** ase1, for display. */
  address: string;
  /** 0x, for the signer. */
  hex: string;
  /** The name without @ when the input was a name, else null. */
  name: string | null;
}

// Signed messages for wallet sign-in. The wallet signs
//   utf8("Asentum Signed Message:\n" + byteLength(message) + "\n") + utf8(message)
// with the account's ML-DSA-65 key (same bytes in the extension, the Telegram
// wallet and @asentum/sdk), so a server verifies every wallet the same way:
// BLAKE3(publicKey)[0..20] == address and ml_dsa65.verify(publicKey, bytes, signature).

export const SIGNED_MESSAGE_PREFIX = 'Asentum Signed Message:\n';
export const SIGNED_MESSAGE_MAX_BYTES = 4096;

export interface SignedMessage {
  /** Signer, ase1. */
  address: string;
  /** ML-DSA-65 public key, 0x hex. */
  publicKey: string;
  /** ML-DSA-65 signature, 0x hex. */
  signature: string;
  /** The message exactly as signed. */
  message: string;
}

/** The wallet cannot sign messages (an extension older than 0.7.0, or an older Telegram wallet). */
export class SignMessageUnsupportedError extends Error {
  constructor(message = 'Your wallet cannot sign messages yet. Update it and try again.') {
    super(message);
    this.name = 'SignMessageUnsupportedError';
  }
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

/** Why a wallet would refuse to sign this message, or null when it is fine. */
export function signMessageProblem(message: unknown): string | null {
  if (typeof message !== 'string') return 'message must be a string';
  if (message.length === 0) return 'message is empty';
  const bytes = new TextEncoder().encode(message).length;
  if (bytes > SIGNED_MESSAGE_MAX_BYTES) return `message is too long (${bytes} bytes, at most ${SIGNED_MESSAGE_MAX_BYTES})`;
  if (FORBIDDEN.test(message)) return 'message contains control or text-direction characters';
  return null;
}

/** The exact bytes a wallet signs for this message (for servers that verify). */
export function signedMessageBytes(message: string): Uint8Array {
  const m = new TextEncoder().encode(message);
  const head = new TextEncoder().encode(`${SIGNED_MESSAGE_PREFIX}${m.length}\n`);
  const out = new Uint8Array(head.length + m.length);
  out.set(head, 0);
  out.set(m, head.length);
  return out;
}

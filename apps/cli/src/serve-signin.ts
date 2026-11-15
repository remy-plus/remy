// One-time sign-in codes for `remy serve`, so a person on the same machine can open a link instead
// of copying the 43-character token. The code lives in memory only (never on disk, never in a log
// except the one line the terminal prints), is stored as a SHA-256 hash, works once, and expires
// after ten minutes. Redeeming it gives the browser its own session token (see serve-token.ts).
import { safeEqual } from './webhook-auth.ts';
import { newToken, sha256Hex } from './webhook-token.ts';

export const SIGN_IN_CODE_TTL_MS = 10 * 60_000;

export interface SignInCodes {
  /** Makes a new code. Any earlier code stops working. */
  mint(): string;
  /** True once for the right, unexpired code; a right but expired code is used up and refused. */
  redeem(code: string): boolean;
}

export function createSignInCodes(
  now: () => number = Date.now,
  ttlMs: number = SIGN_IN_CODE_TTL_MS,
): SignInCodes {
  let current: { hash: string; expires: number } | undefined;
  // A hash nobody can match, so a request with no code pending takes the same path and time.
  const none = sha256Hex(newToken());
  return {
    mint() {
      const code = newToken();
      current = { hash: sha256Hex(code), expires: now() + ttlMs };
      return code;
    },
    redeem(code) {
      const held = current;
      const same = safeEqual(sha256Hex(code), held?.hash ?? none);
      if (!held || !same) return false;
      current = undefined; // single use, whatever happens next
      return held.expires > now();
    },
  };
}

/** The link to print or open. The code sits after the #, so a browser never sends it to a server. */
export function signInLink(host: string, port: number, code: string): string {
  const name = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${name}:${port}/#/sign-in?code=${code}`;
}

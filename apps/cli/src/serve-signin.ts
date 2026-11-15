// One-time sign-in codes for `remy serve`, so a person on the same machine can open a link instead
// of copying the 43-character token. The code lives in memory only (never on disk, never in a log
// except the one line the terminal prints), is stored as a SHA-256 hash, works once, and expires
// after ten minutes. Redeeming it gives the browser its own session token (see serve-token.ts).
import { safeEqual } from './webhook-auth.ts';
import { newToken, sha256Hex } from './webhook-token.ts';

export const SIGN_IN_CODE_TTL_MS = 10 * 60_000;
/** Codes that can wait at once (one per address a phone can reach, and a few `remy serve link`). */
export const SIGN_IN_MAX_PENDING = 8;

export interface SignInCodes {
  /**
   * Makes a new code. By default any earlier code stops working; `keep` leaves the others valid,
   * for one code per address.
   */
  mint(opts?: { keep?: boolean }): string;
  /**
   * Takes a code someone else made, by its SHA-256 hash (64 hex characters), so `remy serve link`
   * can make the code in its own process and the code itself never reaches a file. True when the
   * hash was well formed.
   */
  adopt(hash: string): boolean;
  /** True once for the right, unexpired code; a right but expired code is used up and refused. */
  redeem(code: string): boolean;
}

export function createSignInCodes(
  now: () => number = Date.now,
  ttlMs: number = SIGN_IN_CODE_TTL_MS,
): SignInCodes {
  let held: { hash: string; expires: number }[] = [];
  // A hash nobody can match, so a request with no code pending takes the same path and time.
  const none = sha256Hex(newToken());
  const add = (hash: string, keep: boolean) => {
    const t = now();
    held = [...(keep ? held.filter((h) => h.expires > t) : []), { hash, expires: t + ttlMs }].slice(
      -SIGN_IN_MAX_PENDING,
    );
  };
  return {
    mint(opts) {
      const code = newToken();
      add(sha256Hex(code), opts?.keep === true);
      return code;
    },
    adopt(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash)) return false;
      add(hash, true);
      return true;
    },
    redeem(code) {
      const given = sha256Hex(code);
      // Every held code is compared, so the time does not say which one was close.
      let match: { hash: string; expires: number } | undefined;
      for (const h of [...held, { hash: none, expires: 0 }]) {
        if (safeEqual(given, h.hash) && h.hash !== none) match = h;
      }
      if (!match) return false;
      held = held.filter((h) => h !== match); // single use, whatever happens next
      return match.expires > now();
    },
  };
}

/** The link to print or open. The code sits after the #, so a browser never sends it to a server. */
export function signInLink(host: string, port: number, code: string): string {
  const name = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return signInLinkAt(`http://${name}:${port}`, code);
}

/** The same for an address already written as `http://host:port` (see `reachableUrls`). */
export function signInLinkAt(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/#/sign-in?code=${code}`;
}

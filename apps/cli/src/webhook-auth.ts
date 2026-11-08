// Bearer-token check for webhooks. Both sides are hashed first, so the compare is over equal-length
// buffers and takes the same time whatever the guess; `timingSafeEqual` does the compare.
import { timingSafeEqual } from 'node:crypto';
import type { Hook } from './webhook-store.ts';
import { sha256Hex } from './webhook-token.ts';

/** Constant-time equality of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(a), 'hex'), Buffer.from(sha256Hex(b), 'hex'));
}

/** The token from `Authorization: Bearer <token>`; undefined when the header is not that. */
export function bearer(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const m = /^Bearer ([^\s]+)$/.exec(header);
  return m ? (m[1] as string) : undefined;
}

/**
 * Whether the request may use the hook. A hook with its own token accepts only that token; any
 * other hook, and a name that does not exist, accepts only the shared one, so a caller cannot tell
 * a missing hook from a wrong token.
 */
export function authorized(
  header: string | string[] | undefined,
  hook: Hook | undefined,
  shared: string,
): boolean {
  const given = bearer(header);
  if (given === undefined) return false;
  if (hook?.tokenHash) return safeEqual(sha256Hex(given), hook.tokenHash);
  return safeEqual(given, shared);
}

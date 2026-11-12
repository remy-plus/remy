// The `remy serve` token. 32 random bytes, base64url, shown once by `remy serve token`. Only its
// SHA-256 is kept, in REMY_HOME/serve-token.sha256 (0600), so a stolen file cannot open the API.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newToken, sha256Hex } from './webhook-token.ts';

const fileOf = (home: string) => join(home, 'serve-token.sha256');

/** The saved hash (64 hex characters), or undefined when no token has been made. */
export function serveTokenHash(home: string): string | undefined {
  try {
    const text = readFileSync(fileOf(home), 'utf8').trim();
    return /^[a-f0-9]{64}$/.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Makes a new token, keeps only its hash, and returns the token. The old one stops working. */
export function makeServeToken(home: string): string {
  const token = newToken();
  mkdirSync(home, { recursive: true });
  writeFileSync(fileOf(home), `${sha256Hex(token)}\n`, { mode: 0o600 });
  chmodSync(fileOf(home), 0o600);
  return token;
}

export const FIRST_RUN_TOKEN_FILE = 'serve-token-first-run.txt';

/**
 * Shows a first-run token. On a terminal it is printed. Anywhere else (a container's log is kept and
 * readable) it is written to a private file in `home` instead, and only the place is printed.
 */
export function announceFirstRunToken(
  home: string,
  token: string,
  isTTY: boolean,
  out: (line: string) => void,
): void {
  if (isTTY) {
    out(token);
    out('That is your token. It is shown once. Send it as: Authorization: Bearer <token>');
    return;
  }
  const file = join(home, FIRST_RUN_TOKEN_FILE);
  mkdirSync(home, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  out(
    `Your sign-in token is in ${file}. Read it, sign in, then delete that file. For a new token: remy serve token --rotate`,
  );
}

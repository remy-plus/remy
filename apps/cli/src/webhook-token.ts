// The shared webhook secret: 32 random bytes, base64url, in REMY_HOME/webhook-token (0600). It is
// created on first use and never printed except by `remy webhook token`.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_BYTES = 32;
const MIN_LENGTH = 43; // base64url of 32 bytes

export const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

const fileOf = (home: string) => join(home, 'webhook-token');

/** The shared token; makes one when there is none, or when the file holds something too short. */
export function sharedToken(home: string): string {
  try {
    const text = readFileSync(fileOf(home), 'utf8').trim();
    if (text.length >= MIN_LENGTH) return text;
  } catch {}
  return rotateToken(home);
}

/** Replaces the shared token. Everything that used the old one stops working. */
export function rotateToken(home: string): string {
  const token = newToken();
  mkdirSync(home, { recursive: true });
  writeFileSync(fileOf(home), `${token}\n`, { mode: 0o600 });
  chmodSync(fileOf(home), 0o600);
  return token;
}

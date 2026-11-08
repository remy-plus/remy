import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newToken, rotateToken, sharedToken } from './webhook-token.ts';

const home = () => mkdtempSync(join(tmpdir(), 'remy-token-'));

describe('webhook token', () => {
  it('is at least 32 bytes of randomness', () => {
    const t = newToken();
    expect(Buffer.from(t, 'base64url').length).toBe(32);
    expect(newToken()).not.toBe(t);
  });

  it('is made once, kept in a 0600 file and read back', () => {
    const h = home();
    const a = sharedToken(h);
    expect(sharedToken(h)).toBe(a);
    expect(readFileSync(join(h, 'webhook-token'), 'utf8').trim()).toBe(a);
    expect(statSync(join(h, 'webhook-token')).mode & 0o777).toBe(0o600);
  });

  it('replaces a weak token on disk', () => {
    const h = home();
    writeFileSync(join(h, 'webhook-token'), 'short\n');
    expect(sharedToken(h)).not.toBe('short');
  });

  it('rotates to a new token', () => {
    const h = home();
    const a = sharedToken(h);
    expect(rotateToken(h)).not.toBe(a);
    expect(sharedToken(h)).not.toBe(a);
  });
});

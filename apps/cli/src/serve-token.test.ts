import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveServeBind } from './serve-bind.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';
import { createLockout } from './webhook-lockout.ts';
import { sha256Hex } from './webhook-token.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-serve-token-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('serve token', () => {
  it('has no hash until a token is made', () => {
    expect(serveTokenHash(home)).toBeUndefined();
  });

  it('keeps only the hash, in a private file', () => {
    const token = makeServeToken(home);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(serveTokenHash(home)).toBe(sha256Hex(token));
    const file = join(home, 'serve-token.sha256');
    expect(readFileSync(file, 'utf8')).not.toContain(token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('replaces the token when rotated', () => {
    const a = makeServeToken(home);
    const b = makeServeToken(home);
    expect(a).not.toBe(b);
    expect(serveTokenHash(home)).toBe(sha256Hex(b));
  });
});

describe('serve bind', () => {
  it('defaults to 127.0.0.1:7790', () => {
    expect(resolveServeBind({}, {})).toEqual({ host: '127.0.0.1', port: 7790 });
  });

  it('refuses a non-loopback host without its own env flag', () => {
    expect(() => resolveServeBind({ host: '0.0.0.0' }, {})).toThrow(/REMY_SERVE_ALLOW_REMOTE/);
    expect(() =>
      resolveServeBind({ host: '192.168.1.5' }, { REMY_WEBHOOK_ALLOW_REMOTE: 'on' }),
    ).toThrow();
  });

  it('allows it with the flag, and rejects a bad port', () => {
    const env = { REMY_SERVE_ALLOW_REMOTE: 'on' };
    expect(resolveServeBind({ host: '0.0.0.0', port: '0' }, env)).toEqual({
      host: '0.0.0.0',
      port: 0,
    });
    expect(() => resolveServeBind({ port: '70000' }, {})).toThrow();
  });
});

describe('lockout block time', () => {
  it('can be shorter than the default', () => {
    let t = 0;
    const l = createLockout(() => t, 60_000);
    for (let i = 0; i < 5; i++) l.fail('a');
    expect(l.blocked('a')).toBe(true);
    t = 60_001;
    expect(l.blocked('a')).toBe(false);
  });
});

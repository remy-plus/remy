import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRedactor } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Exec, openCredentials } from './credentials.ts';

let home: string;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), 'remy-cred-')), 'remy-home');
});
afterEach(() => rmSync(join(home, '..'), { recursive: true, force: true }));

/** A fake `security` CLI backed by a map. */
function fakeKeychain() {
  const items = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  const exec: Exec = (_cmd, args, input) => {
    calls.push({ args, ...(input !== undefined && { input }) });
    if (args[0] === '-i') {
      const m = /-a (\S+) -w (\S+)/.exec(input ?? '');
      if (!m) return { status: 1, stdout: '' };
      items.set(m[1] as string, m[2] as string);
      return { status: 0, stdout: '' };
    }
    const account = args[args.indexOf('-a') + 1] as string;
    if (args[0] === 'find-generic-password')
      return items.has(account)
        ? { status: 0, stdout: `${items.get(account)}\n` }
        : { status: 44, stdout: '' };
    if (args[0] === 'delete-generic-password')
      return { status: items.delete(account) ? 0 : 44, stdout: '' };
    return { status: 1, stdout: '' };
  };
  return { exec, items, calls };
}

describe('saved logins', () => {
  it('writes a 0600 file in a 0700 directory when there is no keychain', () => {
    const c = openCredentials({ home, platform: 'linux' });
    expect(c.save('openai', 'sk-test-key-123', { model: 'gpt-5-nano' })).toBe('file');
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, 'credentials.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'logins.json')).mode & 0o777).toBe(0o600);
    expect(c.load('openai')).toEqual({
      provider: 'openai',
      key: 'sk-test-key-123',
      model: 'gpt-5-nano',
    });
    expect(readFileSync(join(home, 'logins.json'), 'utf8')).not.toContain('sk-test-key-123');
  });

  it('uses the macOS keychain, feeding the key on stdin and not in argv', () => {
    const kc = fakeKeychain();
    const c = openCredentials({ home, platform: 'darwin', exec: kc.exec });
    expect(c.save('groq', 'gsk_abc123')).toBe('keychain');
    expect(kc.items.get('groq')).toBe('gsk_abc123');
    expect(kc.calls.flatMap((x) => x.args).join(' ')).not.toContain('gsk_abc123');
    expect(c.load('groq')?.key).toBe('gsk_abc123');
    expect(() => readFileSync(join(home, 'credentials.json'))).toThrow();
    expect(c.remove('groq')).toBe(true);
    expect(kc.items.size).toBe(0);
    expect(c.load('groq')).toBeUndefined();
  });

  it('falls back to the file when the keychain fails or the key is awkward', () => {
    const failing: Exec = () => ({ status: 1, stdout: '' });
    expect(
      openCredentials({ home, platform: 'darwin', exec: failing }).save('openai', 'sk-abcd'),
    ).toBe('file');
    const kc = fakeKeychain();
    const c = openCredentials({ home, platform: 'darwin', exec: kc.exec });
    expect(c.save('custom', 'has"quote')).toBe('file');
    expect(kc.items.size).toBe(0);
  });

  it('tracks the default, lists without keys and removes', () => {
    const c = openCredentials({ home, platform: 'linux' });
    c.save('openai', 'sk-one-1234');
    c.save('ollama', '', { model: 'llama3.1' });
    expect(c.defaultProvider()).toBe('ollama');
    expect(c.load('ollama')).toEqual({ provider: 'ollama', key: '', model: 'llama3.1' });
    expect(JSON.stringify(c.list())).not.toContain('sk-one-1234');
    expect(c.remove('ollama')).toBe(true);
    expect(c.defaultProvider()).toBe('openai');
    expect(c.remove('nope')).toBe(false);
  });

  it('is covered by the redactor', () => {
    const c = openCredentials({ home, platform: 'linux' });
    c.save('openai', 'sk-secret-value-1');
    const redact = createRedactor({ OPENAI_LOGIN_KEY: c.load('openai')?.key ?? '' });
    expect(redact('Authorization: sk-secret-value-1')).toBe(
      'Authorization: [REDACTED:OPENAI_LOGIN_KEY]',
    );
  });
});

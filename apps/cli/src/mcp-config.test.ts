import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRedactor } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import {
  commandLine,
  loadSaved,
  mergeServers,
  removeSaved,
  resolveServers,
  saveSaved,
} from './mcp-config.ts';
import { openSecretStore } from './mcp-secrets.ts';

let home: string;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), 'remy-mcpcfg-')), 'remy-home');
});
afterEach(() => rmSync(join(home, '..'), { recursive: true, force: true }));

const secrets = () => openSecretStore({ home, platform: 'linux' });

describe('merging servers', () => {
  it('lets a config entry replace a saved one with the same name, in saved order', () => {
    const merged = mergeServers(
      { mcpServers: { a: { command: 'saved-a' }, b: { command: 'saved-b' } }, disabled: [] },
      { a: { command: 'config-a' }, c: { url: 'https://c.example/mcp' } },
    );
    expect(merged.map((d) => [d.name, d.source])).toEqual([
      ['a', 'config'],
      ['b', 'saved'],
      ['c', 'config'],
    ]);
    expect(merged[0]?.config).toEqual({ command: 'config-a' });
  });

  it('switches off by the saved list or by enabled: false', () => {
    const merged = mergeServers(
      { mcpServers: { a: { command: 'x' } }, disabled: ['a', 'c'] },
      { b: { command: 'y', enabled: false }, c: { command: 'z' } },
    );
    expect(merged.map((d) => [d.name, d.disabled])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
    ]);
  });

  it('reads mcpServers from remy.config.json like Claude Desktop writes them', () => {
    writeFileSync(
      join(home, '..', 'remy.config.json'),
      JSON.stringify({
        mcpServers: {
          fs: { command: 'npx', args: ['-y', 'x'], type: 'stdio' },
          web: { url: 'https://example.com/mcp' },
        },
      }),
    );
    const cfg = loadConfig(join(home, '..'), home);
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(['fs', 'web']);
  });

  it('explains a server entry that has neither command nor url', () => {
    writeFileSync(join(home, '..', 'remy.config.json'), JSON.stringify({ mcpServers: { x: {} } }));
    expect(() => loadConfig(join(home, '..'), home)).toThrow(/mcpServers.*command or a url/);
  });
});

describe('saved connections', () => {
  it('round-trips through a private file', () => {
    saveSaved(home, { mcpServers: { a: { command: 'x', args: ['1'] } }, disabled: ['a'] });
    expect(statSync(join(home, 'connections.json')).mode & 0o777).toBe(0o600);
    expect(loadSaved(home)).toEqual({
      mcpServers: { a: { command: 'x', args: ['1'] } },
      disabled: ['a'],
    });
  });

  it('is empty when there is no file and says how to fix a damaged one', () => {
    expect(loadSaved(home)).toEqual({ mcpServers: {}, disabled: [] });
    saveSaved(home, { mcpServers: {}, disabled: [] });
    writeFileSync(join(home, 'connections.json'), '{ nope');
    expect(() => loadSaved(home)).toThrow(/Fix or delete the file/);
  });
});

describe('secrets in server config', () => {
  it('fills ${secret:name} in env and headers, and reports the values for the redactor', () => {
    const s = secrets();
    s.set('gh.TOKEN', 'ghp_abcdef123456');
    s.set('web.auth', 'Bearer sk-live-999');
    const declared = mergeServers(
      {
        mcpServers: {
          gh: { command: 'npx', env: { TOKEN: '${secret:gh.TOKEN}', PLAIN: 'yes' } },
          web: { url: 'https://w.example/mcp', headers: { Authorization: '${secret:web.auth}' } },
        },
        disabled: [],
      },
      {},
    );
    const r = resolveServers(declared, s);
    expect(r.servers.gh).toEqual({
      command: 'npx',
      env: { TOKEN: 'ghp_abcdef123456', PLAIN: 'yes' },
    });
    expect(r.servers.web).toEqual({
      url: 'https://w.example/mcp',
      headers: { Authorization: 'Bearer sk-live-999' },
    });
    expect(r.missing).toEqual([]);
    const redact = createRedactor(r.values);
    expect(redact('call failed with ghp_abcdef123456 and Bearer sk-live-999')).not.toMatch(
      /ghp_abcdef|sk-live/,
    );
  });

  it('leaves out a server whose secret is not saved, and a switched-off one', () => {
    const declared = mergeServers(
      {
        mcpServers: {
          a: { command: 'x', env: { T: '${secret:nope}' } },
          b: { command: 'y' },
          c: { command: 'z' },
        },
        disabled: ['c'],
      },
      {},
    );
    const r = resolveServers(declared, secrets());
    expect(Object.keys(r.servers)).toEqual(['b']);
    expect(r.missing).toEqual([{ server: 'a', secret: 'nope' }]);
  });

  it('keeps the value out of connections.json and the secrets file private', () => {
    const s = secrets();
    s.set('a.T', 'sekrit-value-1');
    saveSaved(home, {
      mcpServers: { a: { command: 'x', env: { T: '${secret:a.T}' } } },
      disabled: [],
    });
    expect(readFileSync(join(home, 'connections.json'), 'utf8')).not.toContain('sekrit-value-1');
    expect(statSync(join(home, 'mcp-secrets.json')).mode & 0o777).toBe(0o600);
  });

  it('forgets secrets only the removed server used', () => {
    const s = secrets();
    s.set('a.T', 'value-aaaa');
    s.set('shared', 'value-shared');
    saveSaved(home, {
      mcpServers: {
        a: { command: 'x', env: { T: '${secret:a.T}', S: '${secret:shared}' } },
        b: { command: 'y', env: { S: '${secret:shared}' } },
      },
      disabled: ['a'],
    });
    expect(removeSaved(home, 'a', s)).toBe(true);
    expect(s.get('a.T')).toBeUndefined();
    expect(s.get('shared')).toBe('value-shared');
    expect(loadSaved(home).disabled).toEqual([]);
    expect(removeSaved(home, 'a', s)).toBe(false);
  });

  it('refuses a secret name it cannot keep', () => {
    expect(() => secrets().set('bad name', 'value')).toThrow(/not a valid secret name/);
  });

  it('uses the Keychain like logins do, quoting a value with a space', () => {
    const calls: { args: string[]; input?: string | undefined }[] = [];
    const items = new Map<string, string>();
    const s = openSecretStore({
      home,
      platform: 'darwin',
      exec: (_c, args, input) => {
        calls.push({ args, input });
        if (args[0] === '-i') {
          const m = /-a (\S+) -w (?:"([^"]*)"|(\S+))/.exec(input ?? '');
          items.set(m?.[1] as string, (m?.[2] ?? m?.[3]) as string);
          return { status: 0, stdout: '' };
        }
        const acct = args[args.indexOf('-a') + 1] as string;
        return items.has(acct)
          ? { status: 0, stdout: `${items.get(acct)}\n` }
          : { status: 44, stdout: '' };
      },
    });
    expect(s.set('web.auth', 'Bearer abc123')).toBe('keychain');
    expect(s.get('web.auth')).toBe('Bearer abc123');
    expect(items.has('mcp:web.auth')).toBe(true);
    expect(calls.flatMap((c) => c.args).join(' ')).not.toContain('abc123');
    expect(readFileSync(join(home, 'mcp-secrets.json'), 'utf8')).not.toContain('abc123');
  });
});

describe('commandLine', () => {
  it('quotes what a shell would', () => {
    expect(commandLine({ command: 'npx', args: ['-y', '@x/y', 'my dir'] })).toBe(
      "npx -y @x/y 'my dir'",
    );
    expect(commandLine({ url: 'https://a.example/mcp' })).toBe('https://a.example/mcp');
  });
});

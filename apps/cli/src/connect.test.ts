import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cli } from './cli.ts';
import { buildServer, type ConnectFlags, parsePairs } from './connect.ts';
import { loadSaved } from './mcp-config.ts';
import { importSources, mergeScans, parseImport, secretize } from './mcp-import.ts';
import { openSecretStore } from './mcp-secrets.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-connect-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('building a server from flags', () => {
  const build = (name: string, flags: ConnectFlags, cmd?: string[]) =>
    buildServer(name, flags, cmd);

  it('makes a local server from the words after --', () => {
    expect(build('fs', {}, ['npx', '-y', '@x/fs', '/tmp']).config).toEqual({
      command: 'npx',
      args: ['-y', '@x/fs', '/tmp'],
    });
    expect(build('fs', {}, ['server']).config).toEqual({ command: 'server' });
  });

  it('turns --secret KEY into a reference, in env for a command and in headers for a url', () => {
    const local = build('gh', { secret: ['GITHUB_TOKEN'], env: ['LOG=1'] }, ['gh-mcp']);
    expect(local.config).toEqual({
      command: 'gh-mcp',
      env: { LOG: '1', GITHUB_TOKEN: '${secret:gh.GITHUB_TOKEN}' },
    });
    expect(local.secretKeys).toEqual(['GITHUB_TOKEN']);
    const remote = build('web', {
      url: 'https://w.example/mcp',
      secret: ['Authorization'],
      header: ['X-A=b=c'],
    });
    expect(remote.config).toEqual({
      url: 'https://w.example/mcp',
      headers: { 'X-A': 'b=c', Authorization: '${secret:web.Authorization}' },
    });
  });

  it('rejects what cannot work, with the next step', () => {
    expect(() => build('x', {})).toThrow(/Say what to connect/);
    expect(() => build('x', { url: 'https://a.example' }, ['cmd'])).toThrow(/either a command/);
    expect(() => build('x', { url: 'http://a.example/mcp' })).toThrow(/https/);
    expect(() => build('x', { url: 'not a url' })).toThrow(/not a URL/);
    expect(() => build('bad name', {}, ['c'])).toThrow(/not a usable name/);
    expect(() => build('x', { header: ['a=b'] }, ['c'])).toThrow(/--header goes with --url/);
    expect(() => parsePairs(['novalue'], '--env')).toThrow(/KEY=value/);
  });

  it('allows plain http only for localhost', () => {
    expect(build('l', { url: 'http://localhost:8080/mcp' }).config).toEqual({
      url: 'http://localhost:8080/mcp',
    });
  });
});

describe('importing from other apps', () => {
  const desktop = JSON.stringify({
    mcpServers: {
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_fixture_token_1', LOG_LEVEL: 'info' },
      },
      fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
    },
  });
  const claudeJson = JSON.stringify({
    mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } },
    projects: {
      '/work/proj': { mcpServers: { local: { command: 'node', args: ['s.js'] } } },
      '/other': { mcpServers: { nope: { command: 'x' } } },
    },
  });

  it('reads Claude Desktop and Claude Code, including this folder only from .claude.json projects', () => {
    const a = parseImport('Claude Desktop', desktop, '/work/proj');
    const b = parseImport('Claude Code', claudeJson, '/work/proj');
    expect(a.found.map((f) => f.name)).toEqual(['github', 'fs']);
    expect(b.found.map((f) => f.name)).toEqual(['notion', 'local']);
    expect(b.found[0]?.config).toEqual({ url: 'https://mcp.notion.com/mcp' });
  });

  it('skips what Remy cannot use, with a reason, and keeps the first of a repeated name', () => {
    const odd = parseImport(
      'Project',
      JSON.stringify({
        mcpServers: {
          old: { type: 'sse', url: 'https://x.example/sse' },
          empty: {},
          fs: { command: 'z' },
        },
      }),
      '/',
    );
    expect(odd.skipped.map((s) => s.name)).toEqual(['old', 'empty']);
    expect(odd.skipped[0]?.why).toMatch(/SSE/);
    const merged = mergeScans([parseImport('Claude Desktop', desktop, '/'), odd]);
    expect(merged.found.map((f) => f.name)).toEqual(['github', 'fs']);
    expect(merged.skipped.find((s) => s.name === 'fs')?.why).toMatch(/already lists/);
  });

  it('ignores files that are not JSON objects', () => {
    expect(parseImport('x', 'not json', '/').found).toEqual([]);
    expect(parseImport('x', '[1]', '/').found).toEqual([]);
  });

  it('moves credential-looking values out of the config and leaves the rest', () => {
    const github = parseImport('Claude Desktop', desktop, '/').found[0];
    const r = secretize('github', github?.config ?? { command: '' });
    expect(r.config).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: '${secret:github.GITHUB_PERSONAL_ACCESS_TOKEN}',
        LOG_LEVEL: 'info',
      },
    });
    expect(r.secrets).toEqual({ 'github.GITHUB_PERSONAL_ACCESS_TOKEN': 'ghp_fixture_token_1' });
    expect(JSON.stringify(r.config)).not.toContain('ghp_fixture');
  });

  it('knows where the other apps keep their files', () => {
    const mac = importSources('/Users/me', '/work', 'darwin').map((s) => s.path);
    expect(mac).toContain(
      '/Users/me/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(mac).toContain('/Users/me/.claude.json');
    expect(mac).toContain('/work/.mcp.json');
  });
});

describe('remy connect', () => {
  const files = new Map<string, string>();
  const run = async (argv: string[], extra: Partial<Parameters<typeof cli>[1]> = {}) => {
    const o = { out: '', err: '' };
    const asked: string[] = [];
    const code = await cli(argv, {
      env: { REMY_HOME: join(home, 'h') },
      cwd: '/work/proj',
      out: (s) => {
        o.out += s;
      },
      err: (s) => {
        o.err += s;
      },
      isTTY: false,
      secrets: openSecretStore({ home: join(home, 'h'), platform: 'linux' }),
      homeDir: '/Users/me',
      readText: (p) => files.get(p),
      ...extra,
      ...(extra.ask && {
        ask: async (q: string) => {
          asked.push(q);
          return (extra.ask as (q: string) => Promise<string | null>)(q);
        },
      }),
    });
    return { code, ...o, asked };
  };
  const store = () => openSecretStore({ home: join(home, 'h'), platform: 'linux' });
  beforeEach(() => files.clear());

  it('shows the exact command and will not add a local server without a yes', async () => {
    const r = await run(['connect', 'add', 'fs', '--', 'npx', '-y', '@x/fs']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/runs code on your computer.*--yes/s);
    expect(r.out).toContain('npx -y @x/fs');
    expect(loadSaved(join(home, 'h')).mcpServers).toEqual({});
  });

  it('adds after a yes, stores a secret from stdin in the secret store, never in the config', async () => {
    const r = await run(
      ['connect', 'add', 'gh', '--secret', 'TOKEN', '--secret-stdin', '--', 'gh-mcp'],
      { ask: async () => 'y', isTTY: true, readStdin: async () => 'ghp_stdin_value_1\n' },
    );
    expect(r.code).toBe(0);
    expect(r.asked[0]).toMatch(/Add this server\?/);
    expect(loadSaved(join(home, 'h')).mcpServers.gh).toEqual({
      command: 'gh-mcp',
      env: { TOKEN: '${secret:gh.TOKEN}' },
    });
    expect(store().get('gh.TOKEN')).toBe('ghp_stdin_value_1');
    expect(r.out).not.toContain('ghp_stdin_value_1');
    expect(readFileSync(join(home, 'h', 'connections.json'), 'utf8')).not.toContain('ghp_stdin');
    expect(r.out).toContain('Added gh');
  });

  it('prompts for a masked secret on a terminal and stores nothing when the answer is no', async () => {
    let prompted = 0;
    const no = await run(['connect', 'add', 'x', '--secret', 'T', '--', 'srv'], {
      isTTY: true,
      ask: async () => 'n',
      askSecret: async () => {
        prompted++;
        return 'v';
      },
    });
    expect(no.code).toBe(1);
    expect(prompted).toBe(0);
    expect(store().list()).toEqual([]);
    const yes = await run(['connect', 'add', 'x', '--secret', 'T', '--', 'srv'], {
      isTTY: true,
      ask: async () => 'yes',
      askSecret: async () => 'hidden-value-9',
    });
    expect(yes.code).toBe(0);
    expect(store().get('x.T')).toBe('hidden-value-9');
  });

  it('adds a remote server without a question and lists, then removes it with its secret', async () => {
    const add = await run(
      [
        'connect',
        'add',
        'web',
        '--url',
        'https://w.example/mcp',
        '--secret',
        'Authorization',
        '--secret-stdin',
      ],
      { readStdin: async () => 'Bearer tok-123\n' },
    );
    expect(add.code).toBe(0);
    const list = await run(['connect', 'list']);
    expect(list.out).toMatch(/web\s+remote\s+on\s+saved\s+https:\/\/w\.example\/mcp/);
    expect(list.out).not.toContain('tok-123');
    expect((await run(['connect', 'remove', 'web'])).code).toBe(0);
    expect(store().list()).toEqual([]);
    expect((await run(['connect', 'remove', 'web'])).err).toMatch(/remy connect list/);
  });

  it('refuses a name that is taken and says how to free it', async () => {
    await run(['connect', 'add', 'a', '--yes', '--', 'x']);
    const again = await run(['connect', 'add', 'a', '--yes', '--', 'y']);
    expect(again.err).toMatch(/already a server named a.*remy connect remove a/);
  });

  it('imports after showing what it found, skipping names already connected', async () => {
    files.set(
      '/Users/me/Library/Application Support/Claude/claude_desktop_config.json',
      JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['gh'], env: { GITHUB_TOKEN: 'ghp_import_1' } },
          have: { command: 'z' },
        },
      }),
    );
    files.set(
      '/work/proj/.mcp.json',
      JSON.stringify({ mcpServers: { web: { url: 'https://w.example/mcp' } } }),
    );
    await run(['connect', 'add', 'have', '--yes', '--', 'z']);
    const refused = await run(['connect', '--import']);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('github');
    expect(refused.out).toContain('npx gh');
    expect(refused.out).toContain('Skipped have');
    expect(refused.err).toMatch(/--yes/);
    expect(Object.keys(loadSaved(join(home, 'h')).mcpServers)).toEqual(['have']);

    const done = await run(['connect', '--import', '--yes']);
    expect(done.code).toBe(0);
    const saved = loadSaved(join(home, 'h')).mcpServers;
    expect(Object.keys(saved)).toEqual(['have', 'github', 'web']);
    expect(saved.github).toEqual({
      command: 'npx',
      args: ['gh'],
      env: { GITHUB_TOKEN: '${secret:github.GITHUB_TOKEN}' },
    });
    expect(store().get('github.GITHUB_TOKEN')).toBe('ghp_import_1');
  });

  it('can import just the names asked for, and says so when none match', async () => {
    files.set(
      '/Users/me/.claude.json',
      JSON.stringify({ mcpServers: { a: { command: 'a' }, b: { command: 'b' } } }),
    );
    expect((await run(['connect', '--import', 'zzz', '--yes'])).out).toMatch(/None of those names/);
    await run(['connect', '--import', 'b', '--yes']);
    expect(Object.keys(loadSaved(join(home, 'h')).mcpServers)).toEqual(['b']);
  });
});

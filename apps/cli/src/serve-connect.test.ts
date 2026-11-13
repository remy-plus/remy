import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { McpServerConfig } from '@remy/mcp';
import type { ComputerConfig, Exec } from '@remy/tools';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionRow } from './connections-view.ts';
import { loadSaved, saveSaved } from './mcp-config.ts';
import { openSecretStore } from './mcp-secrets.ts';
import { createConnectMount, STDIO_REFUSAL, writeComputers } from './serve-connect.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';

let kit: Kit | undefined;
afterEach(async () => {
  await kit?.close();
  kit = undefined;
});

interface Setup {
  config?: Record<string, McpServerConfig>;
  rows?: ConnectionRow[];
  tools?: Record<string, string[]>;
  machines?: ComputerConfig[];
  exec?: Exec;
  resolve?: (host: string) => Promise<string[]>;
  registryFetch?: typeof fetch;
}

async function start(s: Setup = {}) {
  const calls = { ssh: [] as string[][], started: [] as string[], saved: [] as ComputerConfig[][] };
  let machines = s.machines ?? [];
  kit = await startKit((home) => [
    createConnectMount({
      home,
      cwd: home,
      userHome: home,
      fromConfig: () => s.config ?? {},
      host: {
        list: () => s.rows ?? [],
        toolNames: (n) => s.tools?.[n] ?? [],
        start: async (n) => {
          calls.started.push(n);
          return '';
        },
      },
      secrets: openSecretStore({ home, platform: 'linux' }),
      computers: () => machines,
      saveComputers: (l) => {
        machines = l;
        calls.saved.push(l);
      },
      exec:
        s.exec ??
        (async (_f, args) => {
          calls.ssh.push(args);
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
      resolve: s.resolve ?? (async () => ['93.184.216.34']),
      ...(s.registryFetch && { registryFetch: s.registryFetch }),
    }),
  ]);
  return { kit, calls };
}

describe('auth and ids', () => {
  it('needs the bearer token on every route', async () => {
    const { kit } = await start();
    for (const [method, path] of [
      ['GET', '/api/connections'],
      ['POST', '/api/connections'],
      ['DELETE', '/api/connections/github'],
      ['POST', '/api/connections/github/permissions'],
      ['GET', '/api/catalog'],
      ['POST', '/api/machines/test'],
      ['POST', '/api/machines'],
      ['DELETE', '/api/machines/home'],
    ] as const) {
      expect((await kit.api(path, { method, token: null })).status).toBe(401);
      expect((await kit.api(path, { method, token: 'wrong' })).status).toBe(401);
    }
  });

  it('refuses an id that is not plain', async () => {
    const { kit } = await start();
    expect((await kit.api('/api/connections/a%20b', { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api('/api/machines/..%2Fx', { method: 'DELETE' })).status).toBe(404);
  });

  it('answers a wrong method with 405', async () => {
    const { kit } = await start();
    expect((await kit.api('/api/connections', { method: 'PUT', body: {} })).status).toBe(405);
    expect((await kit.api('/api/catalog', { method: 'POST', body: {} })).status).toBe(405);
  });
});

describe('GET /api/connections', () => {
  it('lists apps with status, tools as switches, and machines', async () => {
    const { kit } = await start({
      config: { notion: { url: 'https://user:pw@mcp.notion.com/mcp?key=SECRET' } },
      rows: [
        { name: 'notion', kind: 'remote', status: 'connected', tools: 2, source: 'config' },
        { name: 'linear', kind: 'remote', status: 'needs_signin', tools: 0, source: 'saved' },
        {
          name: 'broken',
          kind: 'local',
          status: 'failed',
          reason: 'spawn error',
          tools: 0,
          source: 'saved',
        },
      ],
      tools: { notion: ['search', 'update_page'] },
      machines: [{ name: 'home-server', host: '10.0.0.5', user: 'remy' }],
    });
    saveSaved(kit.home, {
      mcpServers: {
        linear: { url: 'https://mcp.linear.app/mcp', auth: 'oauth' },
        broken: { command: 'nope', args: ['--token', 'SECRET'], env: { K: 'SECRET' } },
      },
      disabled: [],
    });
    const r = await kit.api('/api/connections');
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.json.apps.map((a: { id: string }) => [a.id, a]));
    expect(byId.notion.status).toBe('connected');
    expect(byId.notion.permissions.map((p: { id: string }) => p.id)).toEqual([
      'search',
      'update_page',
    ]);
    expect(byId.linear.status).toBe('needs_signin');
    expect(byId.broken.status).toBe('not_connected');
    expect(byId.broken.blurb).toContain('failed: spawn error');
    expect(r.json.machines).toEqual([
      { name: 'home-server', detail: 'ssh remy@10.0.0.5', status: 'unchecked' },
    ]);
    // Nothing secret leaves: no url credentials, no key, no argument, no env value.
    expect(r.text).not.toContain('SECRET');
    expect(r.text).not.toContain('pw@');
    expect(r.text).not.toContain('--token');
  });
});

describe('permissions', () => {
  const saved = (home: string) => {
    saveSaved(home, {
      mcpServers: { notion: { url: 'https://mcp.notion.com/mcp', auth: 'oauth' } },
      disabled: [],
    });
  };

  it('switches one of the server own tools off and on again', async () => {
    const { kit } = await start({
      rows: [{ name: 'notion', kind: 'remote', status: 'connected', tools: 2, source: 'saved' }],
      tools: { notion: ['search', 'update_page'] },
    });
    saved(kit.home);
    const off = await kit.api('/api/connections/notion/permissions', {
      body: { permissionId: 'update_page', on: false },
    });
    expect(off.status).toBe(200);
    expect(loadSaved(kit.home).mcpServers.notion).toMatchObject({
      tools: { update_page: { disabled: true } },
    });
    let list = await kit.api('/api/connections');
    expect(
      list.json.apps[0].permissions.find((p: { id: string }) => p.id === 'update_page').on,
    ).toBe(false);
    await kit.api('/api/connections/notion/permissions', {
      body: { permissionId: 'update_page', on: true },
    });
    expect(loadSaved(kit.home).mcpServers.notion).toEqual({
      url: 'https://mcp.notion.com/mcp',
      auth: 'oauth',
    });
    list = await kit.api('/api/connections');
    expect(list.json.apps[0].permissions.every((p: { on: boolean }) => p.on)).toBe(true);
  });

  it('refuses a tool the server does not offer, an unknown app and a config-file app', async () => {
    const { kit } = await start({
      config: { fromfile: { url: 'https://example.com/mcp' } },
      tools: { notion: ['search'], fromfile: ['x'] },
    });
    saved(kit.home);
    expect(
      (
        await kit.api('/api/connections/notion/permissions', {
          body: { permissionId: '__proto__', on: false },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await kit.api('/api/connections/nobody/permissions', {
          body: { permissionId: 'x', on: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await kit.api('/api/connections/fromfile/permissions', {
          body: { permissionId: 'x', on: false },
        })
      ).status,
    ).toBe(409);
    // Extra fields are refused, not ignored.
    expect(
      (
        await kit.api('/api/connections/notion/permissions', {
          body: { permissionId: 'search', on: false, command: 'x' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('GET /api/catalog and connecting a catalog entry', () => {
  it('lists only entries that need nothing but a yes', async () => {
    const { kit } = await start();
    const r = await kit.api('/api/catalog');
    const ids = r.json.apps.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['notion', 'linear', 'sentry', 'fetch', 'memory']));
    expect(ids).not.toContain('github'); // needs a token
    expect(ids).not.toContain('filesystem'); // needs a folder
    expect(r.json.apps[0].levels.map((l: { id: string }) => l.id)).toEqual(['act']);
  });

  it('connects an entry defined in code and starts it', async () => {
    const { kit, calls } = await start();
    const r = await kit.api('/api/connections', { body: { catalogId: 'linear', level: 'act' } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ id: 'linear', status: 'needs_signin' });
    expect(loadSaved(kit.home).mcpServers.linear).toMatchObject({
      url: 'https://mcp.linear.app/mcp',
    });
    expect(calls.started).toEqual(['linear']);
    expect(
      (await kit.api('/api/connections', { body: { catalogId: 'linear', level: 'act' } })).status,
    ).toBe(409);
  });

  it('refuses entries that need a token or a folder, an unknown entry and a level it lacks', async () => {
    const { kit } = await start();
    const github = await kit.api('/api/connections', {
      body: { catalogId: 'github', level: 'act' },
    });
    expect(github.status).toBe(400);
    expect(github.json.error).toContain('remy connect');
    expect(
      (await kit.api('/api/connections', { body: { catalogId: 'filesystem', level: 'act' } }))
        .status,
    ).toBe(400);
    expect(
      (await kit.api('/api/connections', { body: { catalogId: 'nope', level: 'act' } })).status,
    ).toBe(404);
    expect(
      (await kit.api('/api/connections', { body: { catalogId: 'notion', level: 'read' } })).status,
    ).toBe(400);
  });
});

describe('adding by address and the stdio refusal', () => {
  it('refuses a command, args, env, a path, headers or a secret, with the same message', async () => {
    const { kit } = await start();
    for (const body of [
      { name: 'x', command: 'rm', args: ['-rf', '/'] },
      { name: 'x', url: 'https://example.com/mcp', command: 'node' },
      { name: 'x', url: 'https://example.com/mcp', args: ['a'] },
      { name: 'x', url: 'https://example.com/mcp', env: { A: 'b' } },
      { name: 'x', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer z' } },
      { catalogId: 'fetch', level: 'act', command: 'sh' },
      { catalogId: 'filesystem', level: 'act', folder: '/' },
      { catalogId: 'fetch', level: 'act', path: '/etc' },
      { catalogId: 'github', level: 'act', token: 'ghp_x' },
    ]) {
      const r = await kit.api('/api/connections', { body });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: STDIO_REFUSAL });
      expect(r.json.error).toContain('remy connect');
    }
    expect(loadSaved(kit.home).mcpServers).toEqual({});
  });

  it('adds an https address, untrusted and without trusting hints', async () => {
    const { kit, calls } = await start();
    const r = await kit.api('/api/connections', {
      body: { name: 'docs', url: 'https://docs.example.com/mcp' },
    });
    expect(r.status).toBe(201);
    expect(loadSaved(kit.home).mcpServers.docs).toEqual({ url: 'https://docs.example.com/mcp' });
    expect(calls.started).toEqual(['docs']);
    expect(
      (
        await kit.api('/api/connections', {
          body: { name: 'docs', url: 'https://docs.example.com/mcp' },
        })
      ).status,
    ).toBe(409);
  });

  it('refuses http, credentials, extras in the address and bad names', async () => {
    const { kit } = await start();
    const add = (name: string, url: string) => kit.api('/api/connections', { body: { name, url } });
    expect((await add('a', 'http://example.com/mcp')).status).toBe(400);
    expect((await add('a', 'https://u:p@example.com/mcp')).status).toBe(400);
    expect((await add('a', 'https://example.com/mcp?token=abc')).status).toBe(400);
    expect((await add('a', 'not a url')).status).toBe(400);
    expect((await add('-bad', 'https://example.com/mcp')).status).toBe(400);
    expect((await add('a b', 'https://example.com/mcp')).status).toBe(400);
  });

  it('refuses private addresses and does not accept allowPrivate', async () => {
    const { kit } = await start({
      resolve: async (h) => (h === 'sneaky.example.com' ? ['10.0.0.9'] : ['93.184.216.34']),
    });
    const add = (url: string, extra: object = {}) =>
      kit.api('/api/connections', {
        body: { name: `n${Math.random().toString(36).slice(2, 8)}`, url, ...extra },
      });
    for (const url of [
      'https://127.0.0.1/mcp',
      'https://192.168.1.4/mcp',
      'https://169.254.169.254/mcp',
      'https://[::1]/mcp',
      'https://localhost/mcp',
      'https://printer.local/mcp',
      'https://intranet/mcp',
      'https://sneaky.example.com/mcp',
    ])
      expect((await add(url)).status, url).toBe(400);
    expect((await add('https://192.168.1.4/mcp', { allowPrivate: true })).status).toBe(400);
    const r = await add('https://192.168.1.4/mcp');
    expect(r.json.error).toContain('remy connect add');
  });

  it('keeps the person-facing message plain for an address that does not resolve', async () => {
    const { kit } = await start({
      resolve: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    const r = await kit.api('/api/connections', {
      body: { name: 'gone', url: 'https://gone.example.com/mcp' },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Remy could not find that address.');
  });
});

describe('DELETE /api/connections/:id', () => {
  it('forgets only the named saved server and the secrets only it used', async () => {
    const { kit } = await start({ config: { fromfile: { url: 'https://example.com/mcp' } } });
    const secrets = openSecretStore({ home: kit.home, platform: 'linux' });
    secrets.set('a.token', 'value-a');
    secrets.set('b.token', 'value-b');
    saveSaved(kit.home, {
      mcpServers: {
        a: {
          url: 'https://a.example.com/mcp',
          headers: { Authorization: 'Bearer ${secret:a.token}' },
        },
        b: {
          url: 'https://b.example.com/mcp',
          headers: { Authorization: 'Bearer ${secret:b.token}' },
        },
      },
      disabled: [],
    });
    const r = await kit.api('/api/connections/a', { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(Object.keys(loadSaved(kit.home).mcpServers)).toEqual(['b']);
    expect(secrets.get('a.token')).toBeUndefined();
    expect(secrets.get('b.token')).toBe('value-b');
    expect((await kit.api('/api/connections/a', { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api('/api/connections/fromfile', { method: 'DELETE' })).status).toBe(409);
  });
});

describe('machines', () => {
  it('refuses this computer, in every spelling', async () => {
    const { kit } = await start();
    for (const host of [
      'localhost',
      'LOCALHOST',
      'a.localhost',
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '::1',
      '[::1]',
      '::',
      '::ffff:127.0.0.1',
      '2130706433',
      hostname(),
    ]) {
      const body = { name: 'me', host, user: 'remy' };
      for (const path of ['/api/machines', '/api/machines/test']) {
        const r = await kit.api(path, { body });
        expect(r.status, host).toBe(400);
        expect(r.json.error, host).toMatch(/this computer/);
      }
    }
  });

  const m = { name: 'home-server', host: 'home.example.com', user: 'remy' };

  it('tests with ssh through sshComputer: batch mode, strict host keys, 10 s, "true"', async () => {
    const { kit, calls } = await start();
    const r = await kit.api('/api/machines/test', { body: { ...m, port: 2222 } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(calls.ssh).toEqual([
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=10',
        '-p',
        '2222',
        'remy@home.example.com',
        '--',
        'true',
      ],
    ]);
  });

  it('reports a failed test in plain lines, with the known-hosts hint', async () => {
    const { kit } = await start({
      exec: async () => ({
        exitCode: 255,
        stdout: '',
        stderr: 'Host key verification failed.\n',
      }),
    });
    const r = await kit.api('/api/machines/test', { body: m });
    expect(r.json.ok).toBe(false);
    expect(r.json.lines.join(' ')).toContain('Host key verification failed');
    expect(r.json.lines.join(' ')).toContain('ssh remy@home.example.com');
  });

  it('accepts home-server and rejects an option-looking or spaced value, never running ssh', async () => {
    const { kit, calls } = await start();
    expect((await kit.api('/api/machines/test', { body: m })).status).toBe(200);
    calls.ssh.length = 0;
    for (const bad of [
      { ...m, name: '-oProxyCommand=x' },
      { ...m, host: '-oProxyCommand=x' },
      { ...m, user: '-oProxyCommand=x' },
      { ...m, name: 'a b' },
      { ...m, host: 'a b' },
      { ...m, user: 'a;b' },
      { ...m, port: 0 },
      { ...m, port: 70000 },
    ]) {
      expect((await kit.api('/api/machines/test', { body: bad })).status, JSON.stringify(bad)).toBe(
        400,
      );
      expect((await kit.api('/api/machines', { body: bad })).status).toBe(400);
    }
    expect(calls.ssh).toEqual([]);
  });

  it('never takes a key path or any other field from the request', async () => {
    const { kit, calls } = await start();
    for (const extra of [{ keyPath: '/home/x/.ssh/id' }, { key: 'AAAA' }, { command: 'id' }]) {
      expect((await kit.api('/api/machines', { body: { ...m, ...extra } })).status).toBe(400);
      expect((await kit.api('/api/machines/test', { body: { ...m, ...extra } })).status).toBe(400);
    }
    expect(calls.saved).toEqual([]);
  });

  it('adds, refuses a repeat, lists and removes only the named machine', async () => {
    const { kit, calls } = await start({
      machines: [{ name: 'other', host: 'other.example.com', user: 'me' }],
    });
    const added = await kit.api('/api/machines', { body: { ...m, port: 2200 } });
    expect(added.status).toBe(201);
    expect(calls.saved.at(-1)).toEqual([
      { name: 'other', host: 'other.example.com', user: 'me' },
      { name: 'home-server', host: 'home.example.com', user: 'remy', port: 2200 },
    ]);
    expect((await kit.api('/api/machines', { body: m })).status).toBe(409);
    const list = await kit.api('/api/connections');
    expect(list.json.machines.map((x: { name: string }) => x.name)).toEqual([
      'other',
      'home-server',
    ]);
    expect((await kit.api('/api/machines/home-server', { method: 'DELETE' })).status).toBe(200);
    expect(calls.saved.at(-1)?.map((c) => c.name)).toEqual(['other']);
    expect((await kit.api('/api/machines/home-server', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('writeComputers', () => {
  it('keeps the other keys of the config file', async () => {
    const { kit } = await start();
    const path = join(kit.home, 'remy.config.json');
    expect(existsSync(path)).toBe(false);
    writeComputers(path, [{ name: 'a', host: 'h', user: 'u' }]);
    writeFileSync(path, JSON.stringify({ model: 'x', computers: [] }));
    writeComputers(path, [{ name: 'b', host: 'h', user: 'u' }]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      model: 'x',
      computers: [{ name: 'b', host: 'h', user: 'u' }],
    });
  });
});

describe('GET /api/connections/search', () => {
  const record = (name: string, title: string, url: string) => ({
    server: {
      name,
      title,
      description: `${title} things.`,
      version: '1.0.0',
      remotes: [{ type: 'streamable-http', url }],
    },
    _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
  });

  const registry = (servers: unknown[], seen: string[] = []) => {
    const fetch = async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ servers }), { status: 200 });
    };
    return { registryFetch: fetch as unknown as typeof globalThis.fetch, seen };
  };

  it('lists what the registry has, with the exact command that adds it', async () => {
    const { registryFetch, seen } = registry([
      record('app.linear/linear', 'Linear', 'https://mcp.linear.app/mcp'),
    ]);
    const { kit } = await start({ registryFetch });
    const r = await kit.api('/api/connections/search?q=linear');
    expect(r.status).toBe(200);
    const body = r.json as { apps: Record<string, unknown>[]; note: string };
    expect(body.apps).toEqual([
      {
        name: 'app.linear/linear',
        title: 'Linear',
        description: 'Linear things.',
        version: '1.0.0',
        kind: 'remote',
        where: 'https://mcp.linear.app/mcp',
        command: 'remy connect --registry app.linear/linear',
      },
    ]);
    expect(body.note).toMatch(/official registry, not from Remy/);
    expect(seen[0]).toContain('search=linear');
  });

  it('passes an https icon through and drops an http one', async () => {
    const withIcon = (name: string, src: string) => {
      const r = record(name, name, `https://${name}.test/mcp`);
      return { ...r, server: { ...r.server, icons: [{ src, mimeType: 'image/png' }] } };
    };
    const { registryFetch } = registry([
      withIcon('a', 'https://a.test/i.png'),
      withIcon('b', 'http://b.test/i.png'),
    ]);
    const { kit } = await start({ registryFetch });
    const body = (await kit.api('/api/connections/search?q=icon')).json as {
      apps: { name: string; icon?: string }[];
    };
    expect(body.apps[0]?.icon).toBe('https://a.test/i.png');
    expect(body.apps[1]).not.toHaveProperty('icon');
  });

  it('adds nothing, and leaves the saved servers alone', async () => {
    const { registryFetch } = registry([
      record('app.linear/linear', 'Linear', 'https://mcp.linear.app/mcp'),
    ]);
    const { kit } = await start({ registryFetch });
    await kit.api('/api/connections/search?q=linear');
    expect(loadSaved(kit.home).mcpServers).toEqual({});
  });

  it('asks for words when the query is empty', async () => {
    const { kit } = await start();
    const r = await kit.api('/api/connections/search?q=');
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Type what to look for/);
  });

  it('answers a wrong method with 405', async () => {
    const { kit } = await start();
    expect((await kit.api('/api/connections/search?q=x', { method: 'DELETE' })).status).toBe(405);
  });

  it('says the registry could not be reached, rather than an empty list', async () => {
    const registryFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    const { kit } = await start({ registryFetch });
    const r = await kit.api('/api/connections/search?q=linear');
    expect(r.status).toBe(502);
    expect(r.json.error).toMatch(/could not be reached/);
  });

  it('reuses an answer for the same words instead of asking again', async () => {
    const { registryFetch, seen } = registry([
      record('app.linear/linear', 'Linear', 'https://mcp.linear.app/mcp'),
    ]);
    const { kit } = await start({ registryFetch });
    await kit.api('/api/connections/search?q=linear');
    await kit.api('/api/connections/search?q=LINEAR');
    expect(seen).toHaveLength(1);
  });
});

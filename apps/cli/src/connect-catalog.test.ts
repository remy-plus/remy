// The curated catalog, the plans built from it, and `remy connect` (picker, add --oauth, auth).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isStdio, mcpServerConfigSchema } from '@remy/mcp';
import { type FakeOAuthServer, fakeOAuthServer } from '@remy/mcp/oauth-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConnectCtx, connectCommand } from './connect.ts';
import {
  applyPlan,
  planCustom,
  planFromEntry,
  SERVER_NAME,
  splitCommand,
  suggestName,
} from './connect-plan.ts';
import { CATALOG, findCatalog } from './mcp-catalog.ts';
import { loadSaved, serverSecretRefs } from './mcp-config.ts';
import { hasOAuthTokens } from './mcp-oauth.ts';
import { openSecretStore } from './mcp-secrets.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-catalog-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
const secrets = () => openSecretStore({ home, platform: 'linux' });

describe('catalog', () => {
  it('has unique, usable ids and a source for every entry', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG) {
      expect(e.id).toMatch(SERVER_NAME);
      expect(e.source).toMatch(/^https:\/\//);
      expect(e.blurb).not.toMatch(/!/);
      expect(e.trustHints).toBe(true);
    }
  });

  it.each(CATALOG.map((e) => [e.id, e] as const))('%s builds a valid config', (_id, e) => {
    const config = e.build({ name: e.id, folder: '/tmp/work' });
    expect(mcpServerConfigSchema.safeParse(config).success).toBe(true);
    // Remote servers are https; OAuth entries say so; token entries refer to exactly their secrets.
    if (!isStdio(config)) expect(config.url).toMatch(/^https:\/\//);
    expect(!isStdio(config) && config.auth === 'oauth').toBe(e.auth === 'oauth');
    const refs = serverSecretRefs(config);
    expect(refs.sort()).toEqual(e.secrets.map((s) => `${e.id}.${s.key}`).sort());
    expect(e.auth === 'token').toBe(e.secrets.length > 0);
    for (const s of e.secrets) expect(s.where.length).toBeGreaterThan(10);
  });

  it('the filesystem entry passes the chosen folder as the only argument after the package', () => {
    const c = findCatalog('filesystem')?.build({ name: 'files', folder: '/Users/a/Docs' });
    expect(c).toMatchObject({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/a/Docs'],
    });
  });
});

describe('plans', () => {
  const o = { taken: new Set<string>(), cwd: '/work', userHome: '/Users/a' };

  it('asks for a folder, makes it absolute, and shows the exact command', () => {
    const fs = findCatalog('filesystem') as (typeof CATALOG)[number];
    expect(() => planFromEntry(fs, o)).toThrow(/Choose a folder/);
    expect(() => planFromEntry(fs, { ...o, folder: '/' })).toThrow(/not the whole disk/);
    const plan = planFromEntry(fs, { ...o, folder: '~/Documents' });
    expect(plan.command).toBe('npx -y @modelcontextprotocol/server-filesystem /Users/a/Documents');
    expect(planFromEntry(fs, { ...o, folder: 'notes' }).command).toContain('/work/notes');
  });

  it('a remote OAuth entry has no command and signs in; a token entry asks for its token', () => {
    const notion = planFromEntry(findCatalog('notion') as (typeof CATALOG)[number], o);
    expect(notion).toMatchObject({ oauth: true, secrets: [] });
    expect(notion.command).toBeUndefined();
    const gh = planFromEntry(findCatalog('github') as (typeof CATALOG)[number], o);
    expect(gh.oauth).toBe(false);
    expect(gh.secrets.map((s) => s.key)).toEqual(['token']);
  });

  it('refuses a name already in use', () => {
    expect(() =>
      planFromEntry(findCatalog('notion') as (typeof CATALOG)[number], {
        ...o,
        taken: new Set(['notion']),
      }),
    ).toThrow(/already a server named notion/);
  });

  it('splits a command line like a shell would, for the simple cases', () => {
    expect(splitCommand(`npx -y "my pkg" 'a b' c\\ d`)).toEqual([
      'npx',
      '-y',
      'my pkg',
      'a b',
      'c\\',
      'd',
    ]);
    expect(() => splitCommand('x "open')).toThrow(/quote/);
  });

  it('a custom server is remote for a web address and local for anything else', () => {
    const t = new Set<string>();
    expect(planCustom('https://x.example/mcp', 'x', t)).toMatchObject({
      config: { url: 'https://x.example/mcp' },
    });
    expect(planCustom('uvx some-server --flag', 'y', t).command).toBe('uvx some-server --flag');
    expect(() => planCustom('http://x.example/mcp', 'x', t)).toThrow(/https/);
    expect(() => planCustom('', 'x', t)).toThrow();
    expect(() => planCustom('cmd', 'bad name', t)).toThrow(/usable name/);
  });

  it('suggests a name from the address or the command, avoiding taken ones', () => {
    expect(suggestName('https://mcp.acme.com/mcp', new Set())).toBe('acme');
    expect(suggestName('npx -y @scope/server-thing', new Set())).toBe('thing');
    expect(suggestName('https://mcp.acme.com/mcp', new Set(['acme']))).toBe('acme-2');
  });

  it('saves nothing unless every secret has a value, and keeps the token out of the config', () => {
    const gh = planFromEntry(findCatalog('github') as (typeof CATALOG)[number], o);
    expect(() => applyPlan(gh, { home, secrets: secrets(), values: {} })).toThrow(
      /Nothing was added/,
    );
    expect(loadSaved(home).mcpServers).toEqual({});
    applyPlan(gh, { home, secrets: secrets(), values: { token: 'ghp_FIXTURE' } });
    expect(secrets().get('github.token')).toBe('ghp_FIXTURE');
    expect(JSON.stringify(loadSaved(home))).not.toContain('ghp_FIXTURE');
  });
});

describe('remy connect', () => {
  let server: FakeOAuthServer;
  beforeEach(async () => {
    server = await fakeOAuthServer();
  });
  afterEach(() => server.close());

  const browser = async (url: string) => {
    const res = await fetch(url, { redirect: 'manual' });
    const back = res.headers.get('location');
    if (back) await fetch(back).catch(() => {});
    return true;
  };

  function ctx(
    rest: string[],
    over: Partial<ConnectCtx> = {},
    lines: string[] = [],
    answers: string[] = [],
    hidden: string[] = [],
  ): ConnectCtx & { lines: string[]; asked: string[] } {
    const asked: string[] = [];
    return {
      rest,
      flags: {},
      commandArgs: undefined,
      home,
      cwd: '/work',
      secrets: secrets(),
      fromConfig: {},
      sources: [],
      readText: () => undefined,
      isTTY: true,
      ask: async (q) => {
        asked.push(q);
        return answers.shift() ?? null;
      },
      askSecret: async () => hidden.shift() ?? null,
      out: (l) => lines.push(l),
      openUrl: browser,
      signInTimeoutMs: 3_000,
      userHome: '/Users/a',
      lines,
      asked,
      ...over,
    };
  }

  it('lists the catalog and a custom option, and cancels on Enter', async () => {
    const c = ctx([], {}, [], ['']);
    expect(await connectCommand(c)).toBe(1);
    const text = c.lines.join('\n');
    for (const e of CATALOG) expect(text).toContain(e.label);
    expect(text).toContain('Custom server');
    expect(loadSaved(home).mcpServers).toEqual({});
  });

  it('without a terminal it prints the usage instead of asking', async () => {
    const c = ctx([], { isTTY: false });
    expect(await connectCommand(c)).toBe(0);
    expect(c.lines.join('\n')).toContain('remy connect auth');
  });

  it('a local entry shows the exact command and needs a yes', async () => {
    const idx = CATALOG.findIndex((e) => e.id === 'filesystem') + 1;
    const no = ctx([], {}, [], [String(idx), '/data/notes', 'n']);
    expect(await connectCommand(no)).toBe(1);
    expect(no.lines.join('\n')).toContain(
      'npx -y @modelcontextprotocol/server-filesystem /data/notes',
    );
    expect(loadSaved(home).mcpServers).toEqual({});

    const yes = ctx([], {}, [], [String(idx), '/data/notes', 'y']);
    expect(await connectCommand(yes)).toBe(0);
    expect(loadSaved(home).mcpServers.filesystem).toMatchObject({ command: 'npx' });
  });

  it('a token entry asks for the token hidden and keeps it out of the saved file', async () => {
    const idx = CATALOG.findIndex((e) => e.id === 'github') + 1;
    const c = ctx([], {}, [], [String(idx)], ['ghp_FIXTURE_TOKEN']);
    expect(await connectCommand(c)).toBe(0);
    expect(c.lines.join('\n')).toContain('github.com/settings/personal-access-tokens');
    expect(c.lines.join('\n')).not.toContain('ghp_FIXTURE_TOKEN');
    expect(secrets().get('github.token')).toBe('ghp_FIXTURE_TOKEN');
    expect(loadSaved(home).mcpServers.github).toMatchObject({
      headers: { Authorization: 'Bearer ${secret:github.token}' },
    });
  });

  it('an empty token adds nothing', async () => {
    const idx = CATALOG.findIndex((e) => e.id === 'github') + 1;
    await expect(connectCommand(ctx([], {}, [], [String(idx)], ['']))).rejects.toThrow(
      /Nothing was added/,
    );
    expect(loadSaved(home).mcpServers).toEqual({});
  });

  it('a custom server takes an address or a command and a name', async () => {
    const c = ctx([], {}, [], [String(CATALOG.length + 1), 'https://mcp.acme.com/mcp', '']);
    expect(await connectCommand(c)).toBe(0);
    expect(loadSaved(home).mcpServers.acme).toEqual({ url: 'https://mcp.acme.com/mcp' });
  });

  it('add --oauth saves the server and signs in right away', async () => {
    const lines: string[] = [];
    const c = ctx(['add', 'notion'], { flags: { url: server.url, oauth: true } }, lines);
    expect(await connectCommand(c)).toBe(0);
    expect(loadSaved(home).mcpServers.notion).toEqual({ url: server.url, auth: 'oauth' });
    expect(hasOAuthTokens(secrets(), 'notion')).toBe(true);
    expect(lines.join('\n')).toContain('Signed in to notion');
    expect(lines.join('\n')).not.toMatch(/at-\d|rt-\d/);
  });

  it('auth signs in an existing server, marking it OAuth, and prints the link with --no-browser', async () => {
    const add = ctx(['add', 'x'], { flags: { url: server.url } });
    await connectCommand(add);
    expect(loadSaved(home).mcpServers.x).toEqual({ url: server.url });
    const lines: string[] = [];
    let opened = 0;
    const c = ctx(
      ['auth', 'x'],
      {
        flags: { 'no-browser': true },
        openUrl: async () => {
          opened++;
          return true;
        },
        signInTimeoutMs: 300,
      },
      lines,
    );
    expect(await connectCommand(c)).toBe(1);
    expect(opened).toBe(0);
    expect(lines.join('\n')).toMatch(
      /Open this link to sign in:\n {2}http:\/\/127\.0\.0\.1:\d+\/authorize/,
    );
    expect(lines.join('\n')).toContain('not finished within');
    expect(lines.join('\n')).toContain('remy connect auth x');
    expect(loadSaved(home).mcpServers.x).toMatchObject({ auth: 'oauth' });
  });

  it('auth then says "already signed in" unless forced', async () => {
    await connectCommand(ctx(['add', 'x'], { flags: { url: server.url, oauth: true } }));
    const again = ctx(['auth', 'x']);
    expect(await connectCommand(again)).toBe(0);
    expect(again.lines.join('\n')).toContain('already signed in');
    const forced = ctx(['auth', 'x'], { flags: { force: true } });
    expect(await connectCommand(forced)).toBe(0);
    expect(forced.lines.join('\n')).toContain('Signed in to x');
    expect(server.registrations).toBe(2);
  });

  it('auth refuses a local server, an unknown name and a missing name', async () => {
    await connectCommand(ctx(['add', 'loc'], { commandArgs: ['cmd'], flags: { yes: true } }));
    await expect(connectCommand(ctx(['auth', 'loc']))).rejects.toThrow(/nothing to sign in to/);
    await expect(connectCommand(ctx(['auth', 'nope']))).rejects.toThrow(/no server named nope/);
    await expect(connectCommand(ctx(['auth']))).rejects.toThrow(/Usage/);
  });

  it('remove deletes the sign-in too', async () => {
    await connectCommand(ctx(['add', 'x'], { flags: { url: server.url, oauth: true } }));
    expect(
      secrets()
        .list()
        .map((s) => s.name),
    ).toEqual(['x.oauth']);
    await connectCommand(ctx(['remove', 'x']));
    expect(secrets().list()).toEqual([]);
  });
});

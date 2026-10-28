// Connected servers end to end: remy run with a fake MCP server, and the host's startup rules.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@remy/core';
import type { McpConnectionOptions } from '@remy/mcp';
import { fakeServer, text, tool } from '@remy/mcp/testing';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createRedactor } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cli } from './cli.ts';
import { saveSaved } from './mcp-config.ts';
import { startMcp } from './mcp-host.ts';
import { openSecretStore } from './mcp-secrets.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-mcphost-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const usage = { inTokens: 100, outTokens: 20 };
const call = (name: string, args: unknown) => ({ calls: [{ tool: name, args }], usage });
const secrets = () => openSecretStore({ home, platform: 'linux' });

const echo = tool('echo', {
  description: 'Echo text',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
});
const never: McpConnectionOptions = { createTransport: () => new Promise(() => {}) };
const broken: McpConnectionOptions = {
  createTransport: async () => {
    throw new Error('spawn nope ENOENT');
  },
};

function harness(opts: {
  options: (name: string) => McpConnectionOptions;
  config?: object;
  budget?: number;
}) {
  if (opts.config)
    writeFileSync(join(home, 'remy.config.json'), JSON.stringify(opts.config), 'utf8');
  const store = new MemoryEventStore();
  const o = { out: '', err: '' };
  const run = async (model: ScriptedModelClient, ...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, {
      env: { REMY_HOME: home },
      cwd: home,
      out: (s) => {
        o.out += s;
      },
      err: (s) => {
        o.err += s;
      },
      isTTY: false,
      store,
      model,
      secrets: secrets(),
      mcpOptions: opts.options,
      mcpBudgetMs: opts.budget ?? 2_000,
    });
    return { code, out: o.out, err: o.err };
  };
  return { run, store };
}

const TOKEN = 'ghp_realtoken_ABC123xyz';

describe('remy run with a connected server', () => {
  it('lists its tools for the model, runs one, and keeps the secret out of events and output', async () => {
    secrets().set('fake.TOKEN', TOKEN);
    // The server echoes its own token back, as a careless one might.
    const fake = fakeServer([echo], (_n, args) => text(`echo: ${String(args.text)} ${TOKEN}`));
    const h = harness({
      options: () => fake.options,
      config: {
        mcpServers: {
          fake: {
            command: 'unused',
            env: { TOKEN: '${secret:fake.TOKEN}' },
            tools: { echo: { risk: 'read', effect: 'none' } },
          },
        },
      },
    });
    const model = new ScriptedModelClient([
      call('fake__echo', { text: 'hi' }),
      call('finish', { answer: 'Echoed.' }),
    ]);
    const r = await h.run(model, 'run', 'echo hi');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Echoed.');
    expect(fake.calls).toEqual([{ name: 'echo', args: { text: 'hi' } }]);
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('fake__echo');
    // Nothing the user or the model could see carries the token.
    const events = JSON.stringify(
      (await h.store.listTasks()).length
        ? await h.store.read((await h.store.listTasks())[0]?.taskId as string)
        : [],
    );
    expect(events).toContain('echo: hi');
    expect(events).not.toContain(TOKEN);
    expect(JSON.stringify(model.requests)).not.toContain(TOKEN);
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  it('shows one quiet note for a server that fails, and the task still finishes', async () => {
    const fake = fakeServer([echo], () => text('ok'));
    const h = harness({
      options: (name) => (name === 'bad' ? broken : fake.options),
      config: {
        mcpServers: {
          bad: { command: 'missing-binary' },
          fake: { command: 'unused', tools: { echo: { risk: 'read', effect: 'none' } } },
        },
      },
    });
    const model = new ScriptedModelClient([call('finish', { answer: 'Fine.' })]);
    const r = await h.run(model, 'run', 'hello');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Fine.');
    const notes = r.err.split('\n').filter((l) => l.includes('Could not start'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('bad');
    expect(notes[0]).toContain('remy.config.json');
    expect(r.err).not.toContain('!');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('fake__echo');
  });

  it('does not wait on a server that never answers, and exits cleanly', async () => {
    const fake = fakeServer([echo], () => text('ok'));
    const h = harness({
      options: (name) => (name === 'slow' ? never : fake.options),
      budget: 100,
      config: { mcpServers: { slow: { command: 'x' }, fake: { command: 'unused' } } },
    });
    const model = new ScriptedModelClient([call('finish', { answer: 'On time.' })]);
    const started = Date.now();
    const r = await h.run(model, 'run', 'go');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.out).toContain('On time.');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('fake__echo');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('slow__echo');
  });

  it('leaves out a server whose secret is missing and says what to do', async () => {
    const fake = fakeServer([echo], () => text('ok'));
    const h = harness({
      options: () => fake.options,
      config: { mcpServers: { fake: { command: 'x', env: { T: '${secret:fake.T}' } } } },
    });
    const r = await h.run(
      new ScriptedModelClient([call('finish', { answer: 'Fine.' })]),
      'run',
      'go',
    );
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/Could not start fake: the secret "fake\.T" is not saved/);
    expect(fake.connects).toBe(0);
  });

  it('starts nothing when nothing is configured', async () => {
    const h = harness({
      options: () => {
        throw new Error('should not be asked');
      },
    });
    const r = await h.run(
      new ScriptedModelClient([call('finish', { answer: 'Plain.' })]),
      'run',
      'go',
    );
    expect(r.out).toContain('Plain.');
    expect(r.err).toBe('');
  });
});

describe('startMcp', () => {
  const base = () => ({
    home,
    secrets: secrets(),
    redact: createRedactor({}),
    addSecret: () => {},
  });

  it('lets tools from a late server join an attached registry when they arrive', async () => {
    const fast = fakeServer([echo], () => text('ok'));
    const lateFake = fakeServer([tool('later')], () => text('ok'));
    let open: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const late: McpConnectionOptions = {
      createTransport: async () => {
        await gate;
        return lateFake.options.createTransport?.() as never;
      },
    };
    saveSaved(home, {
      mcpServers: { fast: { command: 'a' }, late: { command: 'b' } },
      disabled: [],
    });
    const host = startMcp({
      ...base(),
      budgetMs: 50,
      options: (n) => (n === 'fast' ? fast.options : late),
    });
    const registry = new ToolRegistry();
    host.attach(registry);
    await host.ready;
    expect(registry.list().map((t) => t.name)).toEqual(['fast__echo']);
    expect(host.list().map((r) => [r.name, r.status])).toEqual([
      ['fast', 'connected'],
      ['late', 'starting'],
    ]);
    open?.();
    for (let i = 0; i < 100 && registry.list().length < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(
      registry
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['fast__echo', 'late__later']);
    // A registry attached afterwards gets everything at once.
    const second = new ToolRegistry();
    host.attach(second);
    expect(second.list()).toHaveLength(2);
    await host.close();
  });

  it('scrubs secrets from failure notes and keeps the stderr tail for debug only', async () => {
    secrets().set('s.T', 'sekrit-token-77');
    saveSaved(home, {
      mcpServers: { s: { command: 'x', env: { T: '${secret:s.T}' } } },
      disabled: [],
    });
    const debug: [string, unknown][] = [];
    const added: Record<string, string> = {};
    let redact = createRedactor({});
    const host = startMcp({
      ...base(),
      redact: (t) => redact(t),
      addSecret: (n, v) => {
        added[n] = v;
        redact = createRedactor(added);
      },
      options: () => ({
        createTransport: async () => {
          throw new Error('auth failed for sekrit-token-77');
        },
      }),
      debug: (e, d) => debug.push([e, d]),
    });
    const seen: string[] = [];
    host.onNote((n) => seen.push(n));
    await host.ready;
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('sekrit-token-77');
    expect(seen[0]).toContain('[REDACTED:mcp:s.T]');
    expect(seen[0]).toContain('remy connect remove s');
    // Late listeners still get the notes that already happened.
    const replay: string[] = [];
    host.onNote((n) => replay.push(n));
    expect(replay).toEqual(seen);
    await host.close();
  });

  it('switches servers on and off for the next start, and removes only saved ones', async () => {
    saveSaved(home, { mcpServers: { a: { command: 'x' } }, disabled: [] });
    const host = startMcp({
      ...base(),
      fromConfig: { b: { command: 'y' } },
      options: () => broken,
    });
    await host.ready;
    expect(host.setEnabled('a', false)).toMatch(/switched off.*next time Remy starts/);
    expect(host.list().find((r) => r.name === 'a')?.status).toBe('disabled');
    host.setEnabled('a', true);
    expect(host.list().find((r) => r.name === 'a')?.status).not.toBe('disabled');
    expect(host.remove('b')).toMatch(/remy\.config\.json/);
    expect(host.remove('a')).toMatch(/Removed a/);
    expect(host.list().map((r) => r.name)).toEqual(['b']);
    await host.close();
  });
});

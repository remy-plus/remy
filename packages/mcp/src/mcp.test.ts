import {
  type Effect,
  type Risk,
  type Tool,
  type ToolContext,
  ToolRegistry,
  toolSpec,
} from '@remy/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServerConfig } from './config.ts';
import { McpConnection } from './connection.ts';
import { McpManager } from './manager.ts';
import { fakeServer, text, tool } from './testing/fake-server.ts';
import { classifyMcpTool, mcpToolName, toTools } from './tools.ts';

const cfg = (extra: Partial<McpServerConfig> = {}): McpServerConfig => ({
  command: 'unused',
  ...extra,
});

const ctx = (signal: AbortSignal = new AbortController().signal): ToolContext => ({
  taskId: 't',
  callId: 'c',
  idempotencyKey: 't:c',
  signal,
  fs: {
    readText: () => Promise.reject(new Error()),
    writeText: () => Promise.reject(new Error()),
    list: () => Promise.reject(new Error()),
  },
  net: { get: () => Promise.reject(new Error()) },
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
});

const open: McpConnection[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});
const connect = (fake: { options: ConstructorParameters<typeof McpConnection>[2] }, c = cfg()) => {
  const conn = new McpConnection('fake', c, fake.options);
  open.push(conn);
  return conn;
};

describe('connection', () => {
  it('connects lazily, on first use', async () => {
    const fake = fakeServer([tool('a')], () => text('x'));
    const conn = connect(fake);
    expect(fake.connects).toBe(0);
    expect(conn.connected).toBe(false);
    await conn.listTools();
    expect(fake.connects).toBe(1);
    expect(conn.connected).toBe(true);
  });

  it('lists every page', async () => {
    const names = Array.from({ length: 7 }, (_, i) => `t${i}`);
    const fake = fakeServer(
      names.map((n) => tool(n)),
      () => text('x'),
      { pageSize: 3 },
    );
    const listed = await connect(fake).listTools();
    expect(listed.map((t) => t.name)).toEqual(names);
  });

  it('shares one client between concurrent first uses', async () => {
    const fake = fakeServer([tool('a')], () => text('x'));
    const conn = connect(fake);
    await Promise.all([conn.listTools(), conn.listTools(), conn.listTools()]);
    expect(fake.connects).toBe(1);
  });

  it('calls a tool and returns the raw result', async () => {
    const fake = fakeServer([tool('echo')], (_n, args) => text(`got ${JSON.stringify(args)}`));
    const out = await connect(fake).callTool(
      'echo',
      { a: 1 },
      { signal: new AbortController().signal, timeoutMs: 5000 },
    );
    expect(out.ok).toBe(true);
    expect(fake.calls).toEqual([{ name: 'echo', args: { a: 1 } }]);
  });

  it('reports a connection failure as before_effect', async () => {
    const conn = new McpConnection('broken', cfg(), {
      createTransport: () => {
        throw new Error('spawn ENOENT');
      },
    });
    const out = await conn.callTool(
      'x',
      {},
      { signal: new AbortController().signal, timeoutMs: 1000 },
    );
    expect(out).toMatchObject({ ok: false, phase: 'before_effect', retryable: true });
    if (!out.ok) expect(out.error).toContain('spawn ENOENT');
  });

  it('reports a crash mid-call as unknown and never retryable', async () => {
    const fake = fakeServer([tool('boom')], async () => {
      await fake.crash();
      return text('never delivered');
    });
    const conn = connect(fake);
    const out = await conn.callTool(
      'boom',
      {},
      { signal: new AbortController().signal, timeoutMs: 5000 },
    );
    expect(out).toMatchObject({ ok: false, phase: 'unknown', retryable: false });
  });

  it('reconnects on the next use after a crash', async () => {
    const fake = fakeServer([tool('a')], () => text('ok'));
    const conn = connect(fake);
    await conn.listTools();
    await fake.crash();
    const out = await conn.callTool(
      'a',
      {},
      { signal: new AbortController().signal, timeoutMs: 5000 },
    );
    expect(out.ok).toBe(true);
    expect(fake.connects).toBe(2);
  });

  it('treats an unknown tool (protocol error) as before_effect', async () => {
    const fake = fakeServer([tool('a')], () => {
      throw Object.assign(new Error('no such tool'), { code: -32602 });
    });
    const out = await connect(fake).callTool(
      'zzz',
      {},
      { signal: new AbortController().signal, timeoutMs: 5000 },
    );
    expect(out.ok).toBe(false);
  });

  it('aborts a running call through the signal, as unknown', async () => {
    const fake = fakeServer(
      [tool('slow')],
      (_n, _a, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(text('late')));
        }),
    );
    const ac = new AbortController();
    const conn = connect(fake);
    const p = conn.callTool('slow', {}, { signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 30);
    expect(await p).toMatchObject({ ok: false, phase: 'unknown', retryable: false });
  });

  it('does not send a call whose signal is already aborted', async () => {
    const fake = fakeServer([tool('a')], () => text('x'));
    const ac = new AbortController();
    ac.abort();
    const out = await connect(fake).callTool('a', {}, { signal: ac.signal, timeoutMs: 5000 });
    expect(out).toMatchObject({ ok: false, phase: 'before_effect' });
    expect(fake.connects).toBe(0);
  });

  it('times out a slow call as unknown', async () => {
    const fake = fakeServer([tool('slow')], () => new Promise(() => {}));
    const out = await connect(fake).callTool(
      'slow',
      {},
      { signal: new AbortController().signal, timeoutMs: 50 },
    );
    expect(out).toMatchObject({ ok: false, phase: 'unknown', retryable: false });
  });

  it('close() stops the session and blocks reuse', async () => {
    const fake = fakeServer([tool('a')], () => text('x'));
    const conn = connect(fake);
    await conn.listTools();
    await conn.close();
    await conn.close();
    expect(conn.connected).toBe(false);
    const out = await conn.callTool(
      'a',
      {},
      { signal: new AbortController().signal, timeoutMs: 1000 },
    );
    expect(out).toMatchObject({ ok: false, phase: 'before_effect' });
  });
});

describe('names', () => {
  it.each([
    ['github', 'create_issue', 'github__create_issue'],
    ['My Server', 'Get-Thing.v2', 'my_server__get_thing_v2'],
    ['9lives', 'x', 's_9lives__x'],
    ['!!!', '???', 'mcp__tool'],
  ])('sanitizes %s / %s', (server, t, expected) => {
    expect(mcpToolName(server, t)).toBe(expected);
  });

  it('keeps long names within 64 characters, valid and stable', () => {
    const a = mcpToolName('srv', 'a'.repeat(100));
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(mcpToolName('srv', 'a'.repeat(100))).toBe(a);
    expect(mcpToolName('srv', `${'a'.repeat(100)}b`)).not.toBe(a);
  });

  it('keeps colliding names apart, deterministically, and registers cleanly', () => {
    const conn = new McpConnection('s', cfg());
    const listed = [tool('get-x'), tool('get_x'), tool('Get.X')];
    const names = toTools('s', conn, listed, cfg()).map((t) => t.name);
    expect(new Set(names).size).toBe(3);
    expect(
      toTools('s', conn, [...listed].reverse(), cfg())
        .map((t) => t.name)
        .sort(),
    ).toEqual([...names].sort());
    expect(() => new ToolRegistry(toTools('s', conn, listed, cfg()))).not.toThrow();
  });

  it('keeps names unique across servers that sanitize alike', async () => {
    const a = fakeServer([tool('t')], () => text('a'));
    const b = fakeServer([tool('t')], () => text('b'));
    const m = new McpManager({ 'x-y': cfg(), x_y: cfg() }, (n) =>
      n === 'x-y' ? a.options : b.options,
    );
    const { tools } = await m.loadTools();
    await m.closeAll();
    expect(tools.map((t) => t.name).length).toBe(2);
    expect(new Set(tools.map((t) => t.name)).size).toBe(2);
  });
});

describe('classification', () => {
  const hintSets: [string, { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined][] = [
    ['none', undefined],
    ['readOnly', { readOnlyHint: true }],
    ['readOnly false', { readOnlyHint: false }],
    ['destructive', { destructiveHint: true }],
    ['destructive false', { destructiveHint: false }],
    ['both', { readOnlyHint: true, destructiveHint: true }],
  ];
  const expected = (hints: (typeof hintSets)[number][1], trust: boolean): [Risk, Effect] => {
    if (hints?.destructiveHint === true) return ['irreversible', 'unsafe_to_retry'];
    if (hints?.readOnlyHint === true && trust) return ['read', 'none'];
    return ['send_as_user', 'unsafe_to_retry'];
  };

  for (const [label, hints] of hintSets) {
    for (const trust of [undefined, false, true]) {
      it(`hints ${label}, trustHints ${trust}`, () => {
        const [risk, effect] = expected(hints, trust === true);
        expect(classifyMcpTool(hints, { trustHints: trust }, 't')).toEqual({ risk, effect });
      });
    }
  }

  it.each([
    ['risk only', { risk: 'write' as Risk }, { risk: 'write', effect: 'none' }],
    ['effect only', { effect: 'idempotent' as const }, { risk: 'read', effect: 'idempotent' }],
    [
      'both',
      { risk: 'spend_money' as Risk, effect: 'none' as const },
      { risk: 'spend_money', effect: 'none' },
    ],
  ])('override (%s) wins over trusted hints', (_, override, want) => {
    const config = { trustHints: true, tools: { t: override } };
    expect(classifyMcpTool({ readOnlyHint: true }, config, 't')).toEqual(want);
  });

  it('an override can lower a destructive tool and raises an unhinted one', () => {
    expect(
      classifyMcpTool({ destructiveHint: true }, { tools: { t: { risk: 'write' } } }, 't').risk,
    ).toBe('write');
    expect(classifyMcpTool(undefined, { tools: { t: { risk: 'irreversible' } } }, 't').risk).toBe(
      'irreversible',
    );
  });

  it('overrides apply to the named tool only', () => {
    expect(classifyMcpTool(undefined, { tools: { other: { risk: 'read' } } }, 't').risk).toBe(
      'send_as_user',
    );
  });

  it('omits disabled tools and applies classification to the rest', () => {
    const tools = toTools(
      's',
      new McpConnection('s', cfg()),
      [tool('a'), tool('b', { annotations: { readOnlyHint: true } }), tool('c')],
      cfg({ trustHints: true, tools: { c: { disabled: true } } }),
    );
    expect(tools.map((t) => t.name)).toEqual(['s__a', 's__b']);
    expect(tools.map((t) => t.risk)).toEqual(['send_as_user', 'read']);
    expect(tools.map((t) => t.effect)).toEqual(['unsafe_to_retry', 'none']);
    expect(tools.every((t) => t.outputTrust === 'untrusted')).toBe(true);
  });
});

describe('wrapped tools', () => {
  const wrap = async (
    tools: Parameters<typeof fakeServer>[0],
    handler: Parameters<typeof fakeServer>[1],
    config = cfg(),
  ): Promise<Tool[]> => {
    const fake = fakeServer(tools, handler);
    const conn = connect(fake, config);
    return toTools('fake', conn, await conn.listTools(), config);
  };

  it('converts the input schema, validates, and shows the model the properties', async () => {
    const [t] = await wrap(
      [
        tool('add', {
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              label: { type: 'string', description: 'a label' },
            },
            required: ['a'],
          },
        }),
      ],
      () => text('3'),
    );
    expect(t?.args.safeParse({ a: 1 }).success).toBe(true);
    expect(t?.args.safeParse({ label: 'x' }).success).toBe(false);
    expect(t?.args.safeParse({ a: 'no' }).success).toBe(false);
    const spec = toolSpec(t as Tool);
    expect(JSON.stringify(spec.parameters)).toContain('a label');
    expect(spec.parameters.required).toEqual(['a']);
  });

  it('falls back to a permissive object when the schema cannot be converted', async () => {
    const [t] = await wrap(
      [
        tool('odd', {
          inputSchema: {
            type: 'object',
            properties: { q: { $ref: '#/$defs/missing' } },
            required: ['q'],
          },
        }),
      ],
      () => text('ok'),
    );
    expect(t?.args.safeParse({ q: 1, anything: true }).success).toBe(true);
    expect(JSON.stringify(toolSpec(t as Tool).parameters)).toContain('"q"');
  });

  it('keeps arguments the schema did not mention out of harm: unknown keys survive', async () => {
    const [t] = await wrap(
      [tool('x', { inputSchema: { type: 'object', properties: { a: { type: 'string' } } } })],
      () => text('ok'),
    );
    const parsed = t?.args.parse({ a: 'x', extra: 1 }) as Record<string, unknown>;
    expect(parsed.a).toBe('x');
  });

  it('returns joined text as untrusted output', async () => {
    const [t] = await wrap([tool('t')], () => ({
      content: [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ],
    }));
    expect(await t?.execute({}, ctx())).toEqual({
      ok: true,
      content: 'one\ntwo',
      trust: 'untrusted',
    });
  });

  it('summarizes non-text content', async () => {
    const [t] = await wrap([tool('t')], () => ({
      content: [
        { type: 'text', text: 'see' },
        { type: 'image', data: 'A'.repeat(160_000), mimeType: 'image/png' },
        { type: 'audio', data: 'A'.repeat(4096), mimeType: 'audio/wav' },
        { type: 'resource', resource: { uri: 'file:///a.txt', text: 'inline body' } },
        { type: 'resource', resource: { uri: 'file:///b.bin', blob: 'A'.repeat(2048) } },
        { type: 'resource_link', name: 'doc', uri: 'https://x.example/doc' },
      ],
    }));
    const r = await t?.execute({}, ctx());
    expect(r).toMatchObject({ ok: true });
    const c = r?.ok ? r.content : '';
    expect(c).toContain('[image 117 KB]');
    expect(c).toContain('[audio 3 KB]');
    expect(c).toContain('inline body');
    expect(c).toContain('[resource file:///b.bin 2 KB]');
    expect(c).toContain('[link doc https://x.example/doc]');
  });

  it('falls back to structuredContent, and says so when there is no output', async () => {
    const [a, b] = await wrap([tool('a'), tool('b')], (n) =>
      n === 'a' ? { content: [], structuredContent: { n: 1 } } : { content: [] },
    );
    expect(await a?.execute({}, ctx())).toMatchObject({ ok: true, content: '{"n":1}' });
    expect(await b?.execute({}, ctx())).toMatchObject({ ok: true, content: '(no output)' });
  });

  it('maps isError results to a failure that is never retried', async () => {
    const [t] = await wrap([tool('t')], () => ({
      isError: true,
      content: [{ type: 'text', text: 'quota exceeded' }],
    }));
    expect(await t?.execute({}, ctx())).toEqual({
      ok: false,
      error: 'quota exceeded',
      retryable: false,
      phase: 'unknown',
    });
  });

  it('turns a handler that throws into an isError failure', async () => {
    const [t] = await wrap([tool('t')], () => {
      throw new Error('kaboom');
    });
    const r = await t?.execute({}, ctx());
    expect(r).toMatchObject({ ok: false, retryable: false });
    if (r && !r.ok) expect(r.error).toContain('kaboom');
  });

  it('caps long output', async () => {
    const [t] = await wrap([tool('t')], () => text('x'.repeat(50_000)));
    const r = await t?.execute({}, ctx());
    expect(r?.ok && r.content.length).toBeLessThan(20_100);
    expect(r?.ok && r.content).toContain('more characters not shown');
  });

  it('forwards the abort signal to the call', async () => {
    const [t] = await wrap(
      [tool('slow')],
      (_n, _a, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(text('late')));
        }),
    );
    const ac = new AbortController();
    const p = t?.execute({}, ctx(ac.signal));
    setTimeout(() => ac.abort(), 30);
    expect(await p).toMatchObject({ ok: false, phase: 'unknown' });
  });

  it('previews server, tool and compact arguments on one line', async () => {
    const [t] = await wrap([tool('send')], () => text('x'));
    expect(t?.preview({ to: 'a@b.c' })).toBe('fake: send {"to":"a@b.c"}');
    expect(t?.preview({})).toBe('fake: send');
    const long = t?.preview({ body: 'x'.repeat(500) }) ?? '';
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long).not.toContain('\n');
  });

  it('describes the tool and names its server', async () => {
    const [t] = await wrap([tool('t', { description: 'Does a thing' })], () => text('x'));
    expect(t?.description).toBe('Does a thing (via fake)');
  });

  it('uses the configured timeout', async () => {
    const [t] = await wrap([tool('t')], () => text('x'), cfg({ timeoutMs: 7000 }));
    expect(t?.timeoutMs).toBe(7000);
  });
});

describe('manager', () => {
  it('loads tools from every enabled server and reports the ones that fail', async () => {
    const good = fakeServer([tool('a'), tool('b')], () => text('x'));
    const m = new McpManager({ good: cfg(), off: cfg({ enabled: false }), bad: cfg() }, (n) =>
      n === 'good'
        ? good.options
        : {
            createTransport: () => {
              throw new Error('nope');
            },
          },
    );
    const { tools, errors } = await m.loadTools();
    expect(tools.map((t) => t.name)).toEqual(['good__a', 'good__b']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.server).toBe('bad');
    expect(m.status()).toEqual([
      { name: 'good', enabled: true, connected: true },
      { name: 'off', enabled: false, connected: false },
      { name: 'bad', enabled: true, connected: false },
    ]);
    await m.closeAll();
    expect(m.status()[0]?.connected).toBe(false);
  });

  it('runs a loaded tool end to end and closes everything', async () => {
    const fake = fakeServer([tool('hi')], () => text('hello'));
    const m = new McpManager({ s: cfg() }, () => fake.options);
    const { tools } = await m.loadTools();
    expect(await tools[0]?.execute({}, ctx())).toMatchObject({ ok: true, content: 'hello' });
    await m.closeAll();
    expect(m.status()[0]?.connected).toBe(false);
  });

  it('throws for an unknown server name', () => {
    expect(() => new McpManager({}).connection('x')).toThrow(/no MCP server/);
  });
});

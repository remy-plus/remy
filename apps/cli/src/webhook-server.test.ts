import { afterEach, describe, expect, it } from 'vitest';
import { createRunGate } from './webhook-limits.ts';
import { createLockout } from './webhook-lockout.ts';
import { type HandlerDeps, type Listening, listenWebhook } from './webhook-server.ts';
import { sha256Hex } from './webhook-token.ts';

const TOKEN = 'T0KEN-'.repeat(8);
const hooks = {
  deploys: { name: 'deploys', prompt: 'Summarise.', createdAt: 'x' },
  own: { name: 'own', prompt: 'Own.', createdAt: 'x', tokenHash: sha256Hex('own-token') },
} as Record<
  string,
  HandlerDeps extends never
    ? never
    : { name: string; prompt: string; createdAt: string; tokenHash?: string }
>;

let listening: Listening | undefined;
afterEach(async () => {
  await listening?.close();
  listening = undefined;
});

async function setup(over: Partial<HandlerDeps> = {}) {
  const logs: string[] = [];
  const started: { name: string; payload: string }[] = [];
  let n = 0;
  listening = await listenWebhook({
    hook: (name) => hooks[name],
    sharedToken: () => TOKEN,
    start: async (hook, payload) => {
      started.push({ name: hook.name, payload });
      return `task_${++n}`;
    },
    isActive: async () => true,
    log: (l) => logs.push(l),
    gate: createRunGate(() => 0, 0),
    ...over,
  });
  const url = (p: string) => `http://127.0.0.1:${listening?.port}${p}`;
  const post = (
    p: string,
    init: { token?: string; body?: string; type?: string; method?: string } = {},
  ) =>
    fetch(url(p), {
      method: init.method ?? 'POST',
      headers: {
        ...(init.token !== undefined && { authorization: `Bearer ${init.token}` }),
        'content-type': init.type ?? 'application/json',
      },
      ...(init.method !== 'GET' && { body: init.body ?? '{}' }),
    });
  return { logs, started, post, url };
}

describe('webhook server', () => {
  it('binds to loopback on a random port', async () => {
    await setup();
    expect(listening?.host).toBe('127.0.0.1');
    expect(listening?.port).toBeGreaterThan(0);
  });

  it('answers 202 with a run id only', async () => {
    const { post, started } = await setup();
    const r = await post('/hook/deploys', { token: TOKEN, body: '{"a":1}' });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ run: 'task_1' });
    expect(started).toEqual([{ name: 'deploys', payload: '{"a":1}' }]);
  });

  it('accepts a hook own token and refuses the shared one for it', async () => {
    const { post } = await setup();
    expect((await post('/hook/own', { token: 'own-token' })).status).toBe(202);
    expect((await post('/hook/own', { token: TOKEN })).status).toBe(401);
  });

  it('401 with an empty body for a wrong or missing token, same for an unknown hook', async () => {
    const { post, started } = await setup();
    for (const [p, token] of [
      ['/hook/deploys', 'wrong'],
      ['/hook/deploys', undefined],
      ['/hook/nope', 'wrong'],
      ['/hook/nope', undefined],
    ] as const) {
      const r = await post(p, { token });
      expect(r.status).toBe(401);
      expect(await r.text()).toBe('');
    }
    expect(started).toEqual([]);
  });

  it('an unknown hook with the right token is 404, empty', async () => {
    const { post } = await setup();
    const r = await post('/hook/nope', { token: TOKEN });
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('');
  });

  it('blocks an address after 5 wrong tokens, even for the right token', async () => {
    const { post, started } = await setup({ lockout: createLockout(() => 0) });
    for (let i = 0; i < 5; i++)
      expect((await post('/hook/deploys', { token: 'bad' })).status).toBe(401);
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(429);
    expect(started).toEqual([]);
  });

  it('does not count a missing token or an OPTIONS preflight toward the lockout', async () => {
    const { post } = await setup({ lockout: createLockout(() => 0) });
    for (let i = 0; i < 8; i++) {
      expect((await post('/hook/deploys', { token: undefined })).status).toBe(401);
      expect((await post('/hook/deploys', { method: 'OPTIONS' })).status).toBe(405);
    }
    expect((await post('/hook/deploys', { token: TOKEN })).status).not.toBe(429);
  });

  it('allows POST only', async () => {
    const { post } = await setup();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await post('/hook/deploys', { token: TOKEN, method });
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('POST');
    }
  });

  it('answers only on /hook/<name>', async () => {
    const { post } = await setup();
    for (const p of ['/', '/hooks/deploys', '/hook/', '/hook/a/b', '/hook/..%2Fx', '/hook/UP']) {
      expect((await post(p, { token: TOKEN })).status).toBe(404);
    }
  });

  it('accepts json and text, refuses other types and bad json', async () => {
    const { post } = await setup({ gate: createRunGate(() => 0, 0) });
    expect(
      (await post('/hook/deploys', { token: TOKEN, type: 'text/plain', body: 'hi' })).status,
    ).toBe(202);
    expect(
      (await post('/hook/deploys', { token: TOKEN, type: 'application/xml', body: '<a/>' })).status,
    ).toBe(415);
    expect((await post('/hook/deploys', { token: TOKEN, body: '{nope' })).status).toBe(400);
  });

  it('413 above 64 KB, and exactly 64 KB is fine', async () => {
    const { post, started } = await setup();
    const big = await post('/hook/deploys', {
      token: TOKEN,
      type: 'text/plain',
      body: 'x'.repeat(64 * 1024 + 1),
    });
    expect(big.status).toBe(413);
    const ok = await post('/hook/deploys', {
      token: TOKEN,
      type: 'text/plain',
      body: 'x'.repeat(64 * 1024),
    });
    expect(ok.status).toBe(202);
    expect(started).toHaveLength(1);
  });

  it('408 when the body does not arrive in time', async () => {
    const { url } = await setup({ readTimeoutMs: 100 });
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const req = request(
        url('/hook/deploys'),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'content-type': 'text/plain',
            'content-length': '50',
          },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on('error', () => resolve(0));
      req.write('slow');
    });
    expect(status).toBe(408);
  });

  it('429 for a second start of the same hook within 10 seconds', async () => {
    let t = 0;
    const { post } = await setup({ gate: createRunGate(() => t) });
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(429);
    t = 10_000;
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
  });

  it('429 when 3 runs are already going', async () => {
    const { post } = await setup({ gate: createRunGate(() => 0, 0) });
    for (let i = 0; i < 3; i++)
      expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(429);
  });

  it('a finished run frees its place', async () => {
    let live = true;
    const { post } = await setup({
      gate: createRunGate(() => 0, 0),
      isActive: async () => live,
      maxRunning: 1,
    });
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(429);
    live = false;
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
  });

  it('a failed start is 500, empty, and frees the slot', async () => {
    let fail = true;
    const { post } = await setup({
      start: async () => {
        if (fail) throw new Error(`boom ${TOKEN}`);
        return 'task_9';
      },
    });
    const r = await post('/hook/deploys', { token: TOKEN });
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('');
    fail = false;
    expect((await post('/hook/deploys', { token: TOKEN })).status).toBe(202);
  });

  it('logs no token and no payload, only size and a hash', async () => {
    const { post, logs } = await setup({
      start: async () => {
        throw new Error(`failed with ${TOKEN}`);
      },
    });
    await post('/hook/deploys', { token: TOKEN, body: '{"password":"hunter2"}' });
    await post('/hook/deploys', { token: 'guess-123' });
    const all = logs.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('guess-123');
    expect(all).not.toContain('hunter2');
    expect(all).toMatch(/\d+ bytes sha256:[0-9a-f]{12}/);
    expect(all).toContain('[token]');
  });
});

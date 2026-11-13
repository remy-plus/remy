import { describe, expect, it } from 'vitest';
import { BOAT_NO_KEY, boatComputer } from './boat-computer.ts';
import { ComputerSetupError, computerFromConfig, describeComputer } from './computer.ts';

const KEY = 'boat_secretkey123';
type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fake Boat: answers each call from a queue of replies, in order, and records the calls. */
function fake(replies: Reply[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({
      method: String(init.method),
      path: u.pathname.replace('/api/v1', '') + u.search,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    });
    const r = replies.shift();
    if (!r) throw new Error('unexpected call');
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const sb = (state: string, id = 'bx_23456789') => ({ body: { ok: true, sandbox: { id, state } } });
const none = { body: { ok: true, sandboxes: [] } };
const done = (o: Record<string, unknown> = {}) => ({
  body: { ok: true, exitCode: 0, stdout: 'hi\n', stderr: '', timedOut: false, ...o },
});
const mk = (replies: Reply[], key: string | null = KEY) => {
  const { f, calls } = fake(replies);
  const c = boatComputer(
    { kind: 'boat', name: 'cloud' },
    { getKey: async () => key ?? undefined, fetch: f, sleep: async () => undefined },
  );
  return { c, calls };
};
const opts = { timeoutMs: 60_000 };

describe('boatComputer', () => {
  it('creates one sandbox on first use, waits for it, runs the command, then reuses it', async () => {
    const { c, calls } = mk([
      none,
      { status: 202, body: { ok: true, sandbox: { id: 'bx_23456789', state: 'provisioning' } } },
      sb('provisioning'),
      sb('ready'),
      done(),
      sb('idle'),
      done({ stdout: 'again\n' }),
    ]);
    const r = await c.run('echo hi', opts);
    expect(r).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' });
    expect((await c.run('echo again', opts)).stdout).toBe('again\n');
    const create = calls.find((x) => x.method === 'POST' && x.path === '/sandboxes');
    expect(create?.body).toEqual({
      name: 'remy-cloud',
      type: 'default',
      ttlSeconds: 3600,
      labels: { 'remy-computer': 'remy-cloud' },
    });
    expect(create?.headers['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
    expect(calls.every((x) => x.headers.authorization === `Bearer ${KEY}`)).toBe(true);
    expect(calls.filter((x) => x.path === '/sandboxes' && x.method === 'POST')).toHaveLength(1);
    const cmd = calls.find((x) => x.path === '/sandboxes/bx_23456789/commands');
    expect(cmd?.body).toEqual({ command: 'echo hi', timeoutSeconds: 60 });
  });

  it('finds the machine a past run made instead of creating a second one', async () => {
    const { c, calls } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      done(),
    ]);
    await c.run('true', opts);
    expect(calls[0]?.path).toContain('label=remy-computer%3Dremy-cloud');
    expect(calls.some((x) => x.method === 'POST' && x.path === '/sandboxes')).toBe(false);
  });

  it('resumes a stopped machine before running', async () => {
    const { c, calls } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'archived' }] } },
      sb('archived', 'bx_aaaaaaaa'),
      { status: 202, body: { ok: true } },
      sb('ready', 'bx_aaaaaaaa'),
      done(),
    ]);
    await c.run('true', opts);
    const resume = calls.find((x) => x.path.endsWith('/resume'));
    expect(resume?.body).toEqual({ ttlSeconds: 3600 });
  });

  it('sends the size and idle stop the config asked for', async () => {
    const { f, calls } = fake([none, sb('provisioning'), sb('ready'), done()]);
    const c = boatComputer(
      { kind: 'boat', name: 'big', size: 'large', idleStopSeconds: 7200 },
      { getKey: async () => KEY, fetch: f, sleep: async () => undefined },
    );
    await c.run('true', opts);
    expect(calls.find((x) => x.method === 'POST' && x.path === '/sandboxes')?.body).toMatchObject({
      type: 'large',
      ttlSeconds: 7200,
    });
  });

  it('passes a non-zero exit, stderr, truncation and timeouts through', async () => {
    const { c } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      done({ exitCode: 2, stderr: 'bad', stdoutTruncated: true }),
      sb('idle', 'bx_aaaaaaaa'),
      done({ exitCode: null, timedOut: true }),
    ]);
    const a = await c.run('x', opts);
    expect(a.exitCode).toBe(2);
    expect(a.stderr).toBe('bad');
    expect(a.stdout).toContain('Boat cut the output');
    const b = await c.run('sleep 99', opts);
    expect(b.timedOut).toBe(true);
  });

  it('with no key, says how to add one and what it costs, and makes no call', async () => {
    const { c, calls } = mk([], null);
    await expect(c.run('x', opts)).rejects.toThrow(BOAT_NO_KEY);
    await expect(c.run('x', opts)).rejects.toBeInstanceOf(ComputerSetupError);
    expect(BOAT_NO_KEY).toMatch(/costs money after its 7-day trial/);
    expect(calls).toHaveLength(0);
  });

  it('does not read the key until a command runs', () => {
    let read = 0;
    const c = boatComputer(
      { kind: 'boat', name: 'cloud' },
      {
        getKey: async () => {
          read++;
          return KEY;
        },
      },
    );
    expect(c.where).toBe('Boat cloud computer remy-cloud (default, EU)');
    expect(read).toBe(0);
  });

  it.each([
    [401, /refused the key/],
    [402, /needs billing/],
    [403, /does not allow that on your plan/],
    [404, /could not find the computer/],
    [429, /limit\. Try again in about 7 seconds/],
    [500, /server problem \(HTTP 500\)/],
    [503, /no free machine/],
  ])('maps HTTP %i to a plain sentence', async (status, re) => {
    const { c } = mk([
      {
        status,
        headers: { 'retry-after': '7' },
        body: { ok: false, code: 'x', message: `bad ${KEY}`, requestId: 'req_1' },
      },
    ]);
    const err = await c.run('x', opts).catch((e) => e);
    expect(err).toBeInstanceOf(ComputerSetupError);
    expect(err.message).toMatch(re);
    expect(err.message).not.toContain(KEY);
  });

  it('keeps the key out of command output and says where the machine is without it', async () => {
    const { c } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      done({ stdout: `token ${KEY}`, stderr: KEY }),
    ]);
    const r = await c.run('env', opts);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(c.where).not.toContain(KEY);
  });

  it('reports a network failure plainly', async () => {
    const { c } = mk([new Error(`connect ECONNREFUSED ${KEY}`)]);
    const err = await c.run('x', opts).catch((e) => e);
    expect(err.message).toBe('Could not reach Boat. Check your connection.');
  });

  it('never resends a command after a 502 that may have run it', async () => {
    const { c, calls } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      {
        status: 502,
        body: { ok: false, code: 'boat_direct_failed', error: { details: { retryable: false } } },
      },
    ]);
    const r = await c.run('rm -rf x', opts);
    expect(r.exitCode).toBe(255);
    expect(r.stderr).toMatch(/may still be running/);
    expect(calls.filter((x) => x.path.endsWith('/commands'))).toHaveLength(1);
  });

  it('says a retryable 502 never ran the command', async () => {
    const { c } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      { status: 502, body: { ok: false, code: 'x', error: { details: { retryable: true } } } },
    ]);
    expect((await c.run('x', opts)).stderr).toMatch(/did not run/);
  });

  it('waits and resends once after a 409, because the command never started', async () => {
    const { c, calls } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('idle', 'bx_aaaaaaaa'),
      { status: 409, body: { ok: false, code: 'sandbox_not_ready' } },
      sb('ready', 'bx_aaaaaaaa'),
      done(),
    ]);
    expect((await c.run('x', opts)).exitCode).toBe(0);
    expect(calls.filter((x) => x.path.endsWith('/commands'))).toHaveLength(2);
  });

  it('refuses a machine in a failed state', async () => {
    const { c } = mk([
      { body: { ok: true, sandboxes: [{ id: 'bx_aaaaaaaa', state: 'idle' }] } },
      sb('error', 'bx_aaaaaaaa'),
    ]);
    await expect(c.run('x', opts)).rejects.toThrow(/state "error"/);
  });

  it('refuses an answer in a shape it does not know', async () => {
    const { c } = mk([none, { status: 202, body: { ok: true } }]);
    await expect(c.run('x', opts)).rejects.toThrow(/shape Remy does not know/);
  });

  it('checks the config', () => {
    const deps = { getKey: async () => KEY };
    expect(() => boatComputer({ kind: 'boat', name: '-x' }, deps)).toThrow(/Invalid name/);
    expect(() => boatComputer({ kind: 'boat', name: 'a', size: 'huge' as never }, deps)).toThrow(
      /Invalid size/,
    );
    expect(() => boatComputer({ kind: 'boat', name: 'a', idleStopSeconds: 5 }, deps)).toThrow(
      /idleStopSeconds/,
    );
  });

  it('is built by computerFromConfig and described without a connection', () => {
    const cfg = { kind: 'boat', name: 'cloud', size: 'small' } as const;
    expect(() => computerFromConfig(cfg)).toThrow(/Boat key/);
    expect(computerFromConfig(cfg, undefined, { getKey: async () => KEY }).where).toContain(
      'small',
    );
    expect(describeComputer(cfg)).toBe('Boat cloud computer remy-cloud (small, EU)');
  });
});

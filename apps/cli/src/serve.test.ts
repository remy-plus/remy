import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConcurrencyError,
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  type EventStore,
  fold,
  type ModelResponse,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { askUser, finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServe, listenServe, type ServeListening } from './serve.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';
import { createLockout } from './webhook-lockout.ts';

const usage = { inTokens: 10, outTokens: 10 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });
const done = (answer = 'Done.') => call('finish', { answer });

let home: string;
let token: string;
let open: ServeListening[] = [];
const logs: string[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-serve-'));
  token = makeServeToken(home);
  logs.length = 0;
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

/** A store that stops writing when told to, as a killed process would: its lease is never renewed. */
function crashable(inner: EventStore) {
  let dead = false;
  const store: EventStore = {
    createTask: (...a) => inner.createTask(...a),
    read: (...a) => inner.read(...a),
    append: async (...a) => {
      if (dead) throw new ConcurrencyError('crashed');
      return inner.append(...a);
    },
    acquireLease: (...a) => inner.acquireLease(...a),
    renewLease: async (l) => (dead ? false : inner.renewLease(l)),
    releaseLease: async (l) => {
      if (!dead) await inner.releaseLease(l);
    },
    listTasks: (...a) => inner.listTasks(...a),
  };
  return { store, crash: () => (dead = true) };
}

const effects = { applied: new Set<string>(), runs: 0, notes: 0 };
beforeEach(() => {
  effects.applied = new Set();
  effects.runs = 0;
  effects.notes = 0;
});

/** A write that needs approval, and an idempotent read that can be held open to simulate a crash. */
const tools = (hold?: Promise<void>) =>
  new ToolRegistry([
    finish,
    askUser,
    defineTool({
      name: 'note',
      description: 'Save a note',
      args: z.object({ text: z.string() }),
      risk: 'write',
      effect: 'none',
      outputTrust: 'trusted',
      timeoutMs: 1000,
      maxOutputChars: 1000,
      preview: (a) => `Save note: ${a.text}`,
      execute: async () => {
        effects.notes++;
        return { ok: true, content: 'saved', trust: 'trusted' };
      },
    }),
    defineTool({
      name: 'ping',
      description: 'Idempotent call',
      args: z.object({}),
      risk: 'read',
      effect: 'idempotent',
      outputTrust: 'untrusted',
      timeoutMs: 5000,
      maxOutputChars: 1000,
      preview: () => 'ping',
      execute: async (_a, ctx) => {
        effects.runs++;
        effects.applied.add(ctx.idempotencyKey);
        if (hold) await hold;
        return { ok: true, content: '<script>alert(1)</script>', trust: 'untrusted' };
      },
    }),
  ]);

async function serve(
  script: ModelResponse[],
  p: {
    store?: EventStore;
    hold?: Promise<void>;
    redact?: (t: string) => string;
    lockout?: ReturnType<typeof createLockout>;
    webRoot?: string;
    limits?: {
      maxRunning?: number;
      maxStreams?: number;
      maxOutcomes?: number;
      outcomeTtlMs?: number;
    };
  } = {},
) {
  const store = p.store ?? new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient(script),
    tools: tools(p.hold),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
    ...(p.redact && { redact: p.redact }),
  });
  const s = await listenServe(
    {
      store,
      runtime,
      home,
      version: '9.9.9',
      config: (_id, trust) => ({
        model: 'scripted',
        permissions: { autoApprove: ['read'], ...(trust && trust !== 'ask' && { trust }) },
        budget: DEFAULT_BUDGET,
        workspaceDir: '/w',
      }),
      tokenHash: () => serveTokenHash(home),
      ...(p.redact && { redact: p.redact }),
      ...(p.lockout && { lockout: p.lockout }),
      ...(p.webRoot && { webRoot: p.webRoot }),
      ...p.limits,
      log: (l) => logs.push(l),
      pollMs: 20,
      busyMs: 50,
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  const base = `http://127.0.0.1:${s.port}`;
  const api = async (
    path: string,
    o: {
      method?: string;
      token?: string | null;
      body?: unknown;
      raw?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const t = o.token === undefined ? token : o.token;
    const res = await fetch(`${base}${path}`, {
      method: o.method ?? (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(t && { authorization: `Bearer ${t}` }),
        ...(o.body !== undefined && { 'content-type': 'application/json' }),
        ...o.headers,
      },
      ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
      ...(o.raw !== undefined && { body: o.raw }),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: a loose view of JSON, for assertions
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return { s, store, runtime, api, base };
}

const until = async <T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  ms = 4000,
): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};

const sse = (text: string) =>
  text
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('id:'))
    .map((b) => {
      const id = Number(/^id: (\d+)$/m.exec(b)?.[1]);
      const data = JSON.parse(/^data: (.*)$/m.exec(b)?.[1] as string);
      return { id, ...data } as { id: number; seq: number; event: { type: string } };
    });

describe('auth', () => {
  it('answers health without a token and refuses everything else without or with a wrong one', async () => {
    const { api } = await serve([]);
    const h = await api('/api/health', { token: null });
    expect(h.status).toBe(200);
    expect(h.json).toEqual({ ok: true, version: '9.9.9' });
    expect((await api('/api/tasks', { token: null })).status).toBe(401);
    expect((await api('/api/tasks', { token: 'wrong' })).status).toBe(401);
    expect((await api('/api/tasks/task_x', { token: 'wrong' })).status).toBe(401);
    expect(
      (await api('/api/tasks', { method: 'POST', body: { prompt: 'x' }, token: 'nope' })).status,
    ).toBe(401);
    expect((await api('/api/tasks')).status).toBe(200);
  });

  it('locks the address out on the 6th wrong try, even with the right token', async () => {
    const { api } = await serve([]);
    for (let i = 0; i < 5; i++)
      expect((await api('/api/tasks', { token: `bad${i}` })).status).toBe(401);
    const sixth = await api('/api/tasks', { token: 'bad5' });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('retry-after')).toBe('60');
    expect((await api('/api/tasks')).status).toBe(429);
    // Health stays open so a supervisor can still see the server is up.
    expect((await api('/api/health', { token: null })).status).toBe(200);
  });

  it('lets the address back in after a minute', async () => {
    let t = 0;
    const { api } = await serve([], { lockout: createLockout(() => t, 60_000) });
    for (let i = 0; i < 5; i++) await api('/api/tasks', { token: 'bad' });
    expect((await api('/api/tasks')).status).toBe(429);
    t = 61_000;
    expect((await api('/api/tasks')).status).toBe(200);
  });

  it('stops accepting a token the moment it is rotated', async () => {
    const { api } = await serve([]);
    expect((await api('/api/tasks')).status).toBe(200);
    const old = token;
    token = makeServeToken(home);
    expect((await api('/api/tasks', { token: old })).status).toBe(401);
    expect((await api('/api/tasks')).status).toBe(200);
  });

  it('sends no CORS headers, not even to a preflight, and never logs the token', async () => {
    const { api } = await serve([done()]);
    const r = await api('/api/tasks', { headers: { origin: 'https://evil.example' } });
    const pre = await api('/api/tasks', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    for (const x of [r, pre])
      expect([...x.headers.keys()].filter((k) => k.startsWith('access-control'))).toEqual([]);
    expect(r.status).toBe(403); // a foreign Origin is refused outright
    expect(pre.status).toBe(403);
    const same = await api('/api/tasks', { method: 'OPTIONS' });
    expect(same.status).toBe(405);
    expect(logs.join('\n')).not.toContain(token);
  });
});

describe('tasks', () => {
  it('starts a task, lists it, and streams its events until it finishes', async () => {
    const { api } = await serve([done('All set.')]);
    const started = await api('/api/tasks', { body: { prompt: 'say hi' } });
    expect(started.status).toBe(201);
    const id = started.json.taskId as string;
    expect(id).toMatch(/^task_[a-f0-9]{12}$/);

    const s = await api(`/api/tasks/${id}/stream`);
    expect(s.status).toBe(200);
    expect(s.headers.get('content-type')).toContain('text/event-stream');
    const events = sse(s.text);
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]?.event.type).toBe('task.created');
    expect(events.at(-1)?.event).toMatchObject({ type: 'task.finished', status: 'succeeded' });

    const view = await api(`/api/tasks/${id}`);
    expect(view.json).toMatchObject({
      taskId: id,
      status: 'succeeded',
      final: { answer: 'All set.' },
    });
    const list = await api('/api/tasks');
    expect(list.json.tasks).toEqual([
      expect.objectContaining({
        id,
        prompt: 'say hi',
        status: 'succeeded',
        costUsd: expect.any(Number),
      }),
    ]);
  });

  it('truncates the listed prompt and rejects bad requests', async () => {
    const { api } = await serve([done()]);
    const long = 'x'.repeat(300);
    expect((await api('/api/tasks', { body: { prompt: long } })).status).toBe(201);
    await until(async () => (await api('/api/tasks')).json.tasks[0]?.status === 'succeeded');
    expect((await api('/api/tasks')).json.tasks[0].prompt).toHaveLength(120);
    expect((await api('/api/tasks', { body: { prompt: '' } })).status).toBe(400);
    expect((await api('/api/tasks', { body: { prompt: 'a', trust: 'root' } })).status).toBe(400);
    expect((await api('/api/tasks', { body: { prompt: 'a', extra: 1 } })).status).toBe(400);
    expect((await api('/api/tasks', { raw: '{nope', headers: {} })).status).toBe(400);
    expect((await api('/api/tasks/task_missing')).status).toBe(404);
    expect((await api('/api/tasks/task_missing/stream')).status).toBe(404);
    expect((await api('/api/tasks/task_missing/cancel', { body: {} })).status).toBe(404);
    expect((await api('/api/nope')).status).toBe(404);
  });

  it('refuses a body over 64 KB', async () => {
    const { api } = await serve([]);
    const r = await api('/api/tasks', { raw: JSON.stringify({ prompt: 'a'.repeat(70_000) }) });
    expect(r.status).toBe(413);
  });

  it('applies the trust level asked for', async () => {
    const { api, store } = await serve([done()]);
    const r = await api('/api/tasks', { body: { prompt: 'go', trust: 'steady' } });
    const s = fold(await store.read(r.json.taskId));
    expect(s.config.permissions.trust).toBe('steady');
  });

  it('returns tool output as a JSON string and redacts secrets everywhere', async () => {
    const redact = (t: string) => t.replaceAll('sk-live-123', '[key]');
    const { api } = await serve([call('ping', {}), done('Key is sk-live-123.')], { redact });
    const id = (await api('/api/tasks', { body: { prompt: 'use sk-live-123' } })).json.taskId;
    const stream = await api(`/api/tasks/${id}/stream`);
    const view = await api(`/api/tasks/${id}`);
    for (const t of [stream.text, view.text]) {
      expect(t).not.toContain('sk-live-123');
      expect(t).toContain('[key]');
    }
    expect(view.headers.get('content-type')).toContain('application/json');
    expect(view.headers.get('x-content-type-options')).toBe('nosniff');
    const ping = view.json.calls.find((c: { tool: string }) => c.tool === 'ping');
    expect(ping.result).toMatchObject({
      ok: true,
      trust: 'untrusted',
      content: '<script>alert(1)</script>',
    });
  });
});

describe('approval', () => {
  it('stops for approval, refuses a wrong hash, and continues on the right one', async () => {
    const { api } = await serve([call('note', { text: 'hello' }), done('Saved.')]);
    const id = (await api('/api/tasks', { body: { prompt: 'note it' } })).json.taskId;
    const waiting = await until(async () => {
      const v = await api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_approval' && v.json;
    });
    expect(waiting.outcome).toMatchObject({ status: 'waiting_approval' });
    const { callId, argsHash, preview } = waiting.pendingApproval;
    expect(preview).toContain('hello');
    expect(effects.notes).toBe(0);

    const wrong = await api(`/api/tasks/${id}/approve`, {
      body: { callId, argsHash: 'f'.repeat(32), granted: true },
    });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error).toContain('different arguments');
    expect(effects.notes).toBe(0);
    expect((await api(`/api/tasks/${id}`)).json.status).toBe('waiting_approval');

    // A made-up call id is refused too, and the field set is strict.
    expect(
      (await api(`/api/tasks/${id}/approve`, { body: { callId: 'nope', argsHash, granted: true } }))
        .status,
    ).toBe(409);
    expect(
      (await api(`/api/tasks/${id}/approve`, { body: { callId, granted: true } })).status,
    ).toBe(400);

    const ok = await api(`/api/tasks/${id}/approve`, { body: { callId, argsHash, granted: true } });
    expect(ok.status).toBe(200);
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'succeeded');
    expect(effects.notes).toBe(1);

    // Single use: the same approval cannot be replayed.
    const again = await api(`/api/tasks/${id}/approve`, {
      body: { callId, argsHash, granted: true },
    });
    expect(again.status).toBe(409);
    expect(effects.notes).toBe(1);
  });

  it('denies with a note, and the call never runs', async () => {
    const { api } = await serve([call('note', { text: 'x' }), done('Skipped.')]);
    const id = (await api('/api/tasks', { body: { prompt: 'note it' } })).json.taskId;
    const w = await until(async () => {
      const v = await api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_approval' && v.json;
    });
    const { callId, argsHash } = w.pendingApproval;
    await api(`/api/tasks/${id}/approve`, {
      body: { callId, argsHash, granted: false, note: 'not now' },
    });
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'succeeded');
    expect(effects.notes).toBe(0);
  });

  it('cancels a task that is waiting', async () => {
    const { api } = await serve([call('note', { text: 'x' })]);
    const id = (await api('/api/tasks', { body: { prompt: 'note it' } })).json.taskId;
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'waiting_approval');
    expect((await api(`/api/tasks/${id}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await api(`/api/tasks/${id}`)).json.status).toBe('cancelled');
  });

  it('answers a question and carries on', async () => {
    const { api } = await serve([call('ask_user', { question: 'Which?' }), done('Blue.')]);
    const id = (await api('/api/tasks', { body: { prompt: 'pick' } })).json.taskId;
    const w = await until(async () => {
      const v = await api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_user' && v.json;
    });
    expect(w.pendingQuestion.question).toBe('Which?');
    expect((await api(`/api/tasks/${id}/answer`, { body: {} })).status).toBe(400);
    expect((await api(`/api/tasks/${id}/answer`, { body: { answer: 'blue' } })).status).toBe(200);
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'succeeded');
    // Nothing is waiting any more, so a second answer is refused.
    expect((await api(`/api/tasks/${id}/answer`, { body: { answer: 'again' } })).status).toBe(409);
  });
});

describe('stream', () => {
  it('returns only newer events when the client reconnects with Last-Event-ID', async () => {
    const { api } = await serve([call('ping', {}), done()]);
    const id = (await api('/api/tasks', { body: { prompt: 'go' } })).json.taskId;
    const all = sse((await api(`/api/tasks/${id}/stream`)).text);
    expect(all.length).toBeGreaterThan(4);
    const cut = 3;
    const rest = sse(
      (await api(`/api/tasks/${id}/stream`, { headers: { 'last-event-id': String(cut) } })).text,
    );
    expect(rest.map((e) => e.id)).toEqual(all.slice(cut).map((e) => e.id));
    expect(rest[0]?.id).toBe(cut + 1);
    const viaQuery = sse((await api(`/api/tasks/${id}/stream?lastEventId=${cut}`)).text);
    expect(viaQuery.map((e) => e.id)).toEqual(rest.map((e) => e.id));
    // Past the end: nothing is replayed, and a finished task still closes the stream.
    const none = sse(
      (await api(`/api/tasks/${id}/stream`, { headers: { 'last-event-id': String(all.length) } }))
        .text,
    ).length;
    expect(none).toBe(0);
  }, 10_000);

  it('follows a live task and ends when it finishes', async () => {
    const { api } = await serve([call('note', { text: 'later' }), done()]);
    const id = (await api('/api/tasks', { body: { prompt: 'go' } })).json.taskId;
    const streaming = api(`/api/tasks/${id}/stream`);
    const w = await until(async () => {
      const v = await api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_approval' && v.json;
    });
    await api(`/api/tasks/${id}/approve`, {
      body: {
        callId: w.pendingApproval.callId,
        argsHash: w.pendingApproval.argsHash,
        granted: true,
      },
    });
    const events = sse((await streaming).text);
    expect(events.some((e) => e.event.type === 'approval.resolved')).toBe(true);
    expect(events.at(-1)?.event.type).toBe('task.finished');
  }, 10_000);
});

describe('recovery', () => {
  it('resumes a task after the server dies mid tool call, with no duplicate side effect', async () => {
    const inner = new MemoryEventStore();
    const first = crashable(inner);
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const one = await serve([call('ping', {}), done('Recovered.')], { store: first.store, hold });
    const id = (await one.api('/api/tasks', { body: { prompt: 'ping it' } })).json.taskId;

    // The write-ahead event is on disk and the tool is running, but has not finished.
    await until(async () => (await inner.read(id)).some((e) => e.event.type === 'tool.started'));
    expect(effects.applied.size).toBe(1);
    first.crash();
    await one.s.close();
    expect((await inner.read(id)).some((e) => e.event.type === 'tool.completed')).toBe(false);

    // A new server on the same store and home picks the task up once the dead lease runs out.
    const two = await serve([done('Recovered.')], { store: inner });
    await until(async () => (await two.api(`/api/tasks/${id}`)).json.status === 'succeeded', 8000);
    const view = await two.api(`/api/tasks/${id}`);
    expect(view.json.final.answer).toBe('Recovered.');

    // The idempotent tool ran again, under the same key, so the effect happened once.
    expect(effects.applied.size).toBe(1);
    const events = (await inner.read(id)).map((e) => e.event.type);
    // One completion for ping and one for finish: the recovered call was recorded once.
    expect(events.filter((t) => t === 'tool.completed')).toHaveLength(2);
    expect(events.filter((t) => t === 'tool.started')).toHaveLength(3);
    expect(events.filter((t) => t === 'task.finished')).toHaveLength(1);

    // The dead server's tool finishing late cannot write anything.
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect((await inner.read(id)).filter((e) => e.event.type === 'task.finished')).toHaveLength(1);
  }, 15_000);

  it('leaves a task that is waiting for approval waiting, and lets the new server approve it', async () => {
    const inner = new MemoryEventStore();
    const one = await serve([call('note', { text: 'keep' })], { store: inner });
    const id = (await one.api('/api/tasks', { body: { prompt: 'note' } })).json.taskId;
    const w = await until(async () => {
      const v = await one.api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_approval' && v.json;
    });
    await one.s.close();
    const two = await serve([done('Saved.')], { store: inner });
    expect((await two.api(`/api/tasks/${id}`)).json.status).toBe('waiting_approval');
    await two.api(`/api/tasks/${id}/approve`, {
      body: {
        callId: w.pendingApproval.callId,
        argsHash: w.pendingApproval.argsHash,
        granted: true,
      },
    });
    await until(async () => (await two.api(`/api/tasks/${id}`)).json.status === 'succeeded');
    expect(effects.notes).toBe(1);
  }, 10_000);
});

describe('the web app on the same port', () => {
  it('serves the app without a token, while the API still needs one', async () => {
    const web = join(home, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<title>Remy</title>');
    writeFileSync(join(web, 'assets', 'a-1.js'), 'x');
    const { api } = await serve([done()], { webRoot: web });
    const root = await api('/', { token: null });
    expect(root.status).toBe(200);
    expect(root.text).toContain('<title>Remy</title>');
    expect(root.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await api('/assets/a-1.js', { token: null })).status).toBe(200);
    expect((await api('/tasks/task_1', { token: null })).text).toContain('<title>Remy</title>');
    // The API wins: health is open, everything else asks for the token, and a missing API route
    // is JSON, never the app.
    expect((await api('/api/health', { token: null })).json.ok).toBe(true);
    expect((await api('/api/tasks', { token: null })).status).toBe(401);
    expect((await api('/api/tasks')).status).toBe(200);
    const missing = await api('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<title>');
    expect((await api('/api')).status).toBe(404);
    expect((await api('/api', { token: null })).text).not.toContain('<title>');
    // Static paths cannot write.
    expect((await api('/', { method: 'POST', body: {}, token: null })).status).toBe(405);
  });

  it('says the app is not built when there is no folder', async () => {
    const { api } = await serve([done()], { webRoot: join(home, 'nothing') });
    const r = await api('/', { token: null });
    expect(r.status).toBe(404);
    expect(r.json.error).toContain('not built');
  });
});

describe('resource caps', () => {
  it('refuses a task beyond the running cap with 429, then accepts one when a run ends', async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const { api } = await serve([call('ping', {}), call('ping', {}), done(), done(), done()], {
      hold,
      limits: { maxRunning: 2 },
    });
    const a = await api('/api/tasks', { body: { prompt: 'one' } });
    const b = await api('/api/tasks', { body: { prompt: 'two' } });
    expect([a.status, b.status]).toEqual([201, 201]);
    const c = await api('/api/tasks', { body: { prompt: 'three' } });
    expect(c.status).toBe(429);
    expect(c.json.error).toBe(
      'Remy is already working on 2 things. Wait for one to finish, or stop one in Activity.',
    );
    release();
    await until(async () => (await api(`/api/tasks/${a.json.taskId}`)).json.status === 'succeeded');
    await until(async () => (await api('/api/tasks', { body: { prompt: 'four' } })).status === 201);
  });

  it('does not count a task waiting for approval as running', async () => {
    const { api } = await serve([call('note', { text: 'x' }), call('note', { text: 'y' })], {
      limits: { maxRunning: 1 },
    });
    const id = (await api('/api/tasks', { body: { prompt: 'a' } })).json.taskId;
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'waiting_approval');
    await until(async () => (await api('/api/tasks', { body: { prompt: 'b' } })).status === 201);
  });

  it('refuses a stream beyond the cap with 429', async () => {
    const { api, base } = await serve([call('note', { text: 'x' })], { limits: { maxStreams: 1 } });
    const id = (await api('/api/tasks', { body: { prompt: 'a' } })).json.taskId;
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'waiting_approval');
    const ctl = new AbortController();
    const first = await fetch(`${base}/api/tasks/${id}/stream`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    expect(first.status).toBe(200);
    expect((await api(`/api/tasks/${id}/stream`)).status).toBe(429);
    ctl.abort();
  });

  it('forgets old and surplus finished outcomes', async () => {
    const store = new MemoryEventStore();
    const runtime = createRuntime({
      store,
      model: new ScriptedModelClient([done(), done(), done(), done()]),
      tools: tools(),
      capabilities: () => ({}) as never,
      sleep: async () => {},
    });
    const serveApi = createServe({
      store,
      runtime,
      home,
      version: '9.9.9',
      config: () => ({
        model: 'scripted',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: '/w',
      }),
      tokenHash: () => serveTokenHash(home),
      log: () => {},
      maxOutcomes: 2,
    });
    for (let i = 0; i < 4; i++) {
      const id = `task_${i}`;
      await store.createTask(id, 'p', {
        model: 'scripted',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: '/w',
      });
      serveApi.ensureRun(id);
      await until(() => !serveApi.runs.has(id));
    }
    expect([...serveApi.outcomes.keys()]).toEqual(['task_2', 'task_3']);
    serveApi.stop();
  });
});

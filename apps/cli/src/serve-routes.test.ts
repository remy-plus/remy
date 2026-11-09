// The home, review, settings and action routes, through a real `remy serve` listener with a fake
// model and a temporary REMY_HOME.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  type EventStore,
  type ModelResponse,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { askUser, finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listenServe, type ServeListening } from './serve.ts';
import { homeRoutes } from './serve-home.ts';
import { configWithPrefs, createSpend, openWebPrefs, settingsRoutes } from './serve-settings.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';

const usage = { inTokens: 10, outTokens: 10 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });

let home: string;
let token: string;
let open: ServeListening[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-routes-'));
  token = makeServeToken(home);
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

const tools = () =>
  new ToolRegistry([
    finish,
    askUser,
    defineTool({
      name: 'note',
      description: 'Send a note',
      args: z.object({ text: z.string() }),
      risk: 'send_as_user',
      effect: 'none',
      outputTrust: 'trusted',
      timeoutMs: 1000,
      maxOutputChars: 1000,
      preview: (a) => `Send: ${a.text}`,
      execute: async () => ({ ok: true, content: 'sent', trust: 'trusted' }),
    }),
  ]);

interface Rig {
  notes?: string[];
  routeModel?: ScriptedModelClient;
  machines?: number;
}

async function serve(script: ModelResponse[], rig: Rig = {}) {
  const store: EventStore = new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient(script),
    tools: tools(),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
  });
  const prefs = openWebPrefs(home, () => undefined);
  const spend = createSpend(store);
  const notes = rig.notes ?? [];
  const model = rig.routeModel ?? new ScriptedModelClient([{ calls: [], text: 'ok', usage }]);
  const s = await listenServe(
    {
      routes: [
        homeRoutes({
          store,
          prefs,
          spend,
          machines: () => rig.machines ?? 0,
          notesCount: () => notes.length,
          notesToday: () => notes.length,
        }),
        settingsRoutes(
          {
            home,
            store,
            prefs,
            version: '9.9.9',
            provider: 'ollama',
            modelId: 'llama3',
            pricing: { inPerMTok: 0, outPerMTok: 0 },
            address: () => '127.0.0.1:7790',
            notesCount: () => notes.length,
          },
          spend,
        ),
      ],
      store,
      runtime,
      home,
      version: '9.9.9',
      config: (_id, trust) =>
        configWithPrefs(
          {
            model: 'scripted',
            permissions: { autoApprove: ['read'] },
            budget: DEFAULT_BUDGET,
            workspaceDir: '/w',
          },
          prefs.chosen(),
          trust,
        ),
      tokenHash: () => serveTokenHash(home),
      log: () => {},
      pollMs: 20,
      busyMs: 50,
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  const url = `http://127.0.0.1:${s.port}`;
  const api = async (
    path: string,
    o: { method?: string; token?: string | null; body?: unknown; raw?: string } = {},
  ) => {
    const t = o.token === undefined ? token : o.token;
    const res = await fetch(`${url}${path}`, {
      method: o.method ?? (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(t && { authorization: `Bearer ${t}` }),
        ...(o.body !== undefined && { 'content-type': 'application/json' }),
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
    return { status: res.status, json, text };
  };
  return { s, store, api, model, notes, prefs };
}

const until = async <T>(fn: () => Promise<T | undefined | false>, ms = 4000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};

const ROUTES: [string, string][] = [
  ['GET', '/api/home'],
  ['GET', '/api/settings'],
  ['PUT', '/api/settings'],
];

describe('every new route', () => {
  it('needs the bearer token and sends no CORS headers', async () => {
    // One server per route: wrong tokens lock an address out after five tries.
    for (const [method, path] of ROUTES) {
      const { api } = await serve([]);
      expect((await api(path, { method, token: null })).status, path).toBe(401);
      expect((await api(path, { method, token: 'wrong' })).status, path).toBe(401);
    }
    const { s } = await serve([]);
    const res = await fetch(`http://127.0.0.1:${s.port}/api/settings`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' },
    });
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control'))).toEqual([]);
  });

  it('answers a wrong method with 405', async () => {
    const { api } = await serve([]);
    expect((await api('/api/home', { method: 'POST', body: {} })).status).toBe(405);
    expect((await api('/api/settings', { method: 'POST', body: {} })).status).toBe(405);
    expect((await api('/api/settings', { method: 'DELETE' })).status).toBe(405);
  });
});

describe('settings', () => {
  it('starts with defaults and says the app is dark only', async () => {
    const { api } = await serve([], { notes: ['a', 'b'] });
    const r = await api('/api/settings');
    expect(r.status).toBe(200);
    expect(r.json.prefs).toEqual({
      trust: 'ask',
      budget: { monthly: 20, perTask: 2 },
      remember: true,
      quiet: false,
      quietHours: { from: '23:00', to: '07:00' },
      notifications: { approvals: true, finished: true, noticed: false, reviewAt: '07:30' },
      appearance: 'dark',
    });
    expect(r.json.notes).toBe(2);
    expect(r.json.about).toMatchObject({ version: '9.9.9', dataDir: home });
    expect(r.json.models.everyday).toBe('llama3');
    expect(r.json.providers[0]).toMatchObject({ id: 'ollama', state: 'running' });
    expect(r.json.server.address).toBe('127.0.0.1:7790');
  });

  it('saves a change, keeps it after a restart, and writes the file as 0600', async () => {
    const { api } = await serve([]);
    const put = await api('/api/settings', {
      method: 'PUT',
      body: {
        trust: 'away',
        budget: { perTask: 3.5 },
        quietHours: { from: '22:30' },
        notifications: { reviewAt: '08:00', noticed: true },
        quiet: true,
        remember: false,
      },
    });
    expect(put.status).toBe(200);
    expect(put.json.prefs).toMatchObject({
      trust: 'away',
      budget: { monthly: 20, perTask: 3.5 },
      quietHours: { from: '22:30', to: '07:00' },
      notifications: { approvals: true, finished: true, noticed: true, reviewAt: '08:00' },
      quiet: true,
      remember: false,
    });
    const file = join(home, 'web-prefs.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).trust).toBe('away');
    // A new server on the same folder reads it back.
    const again = await serve([]);
    expect((await again.api('/api/settings')).json.prefs.trust).toBe('away');
  });

  it('refuses bad values, unknown keys and other appearances, and saves nothing', async () => {
    const { api } = await serve([]);
    const bad: unknown[] = [
      { trust: 'root' },
      { budget: { monthly: -1 } },
      { budget: { monthly: 0 } },
      { budget: { perTask: 1e9 } },
      { budget: { perTask: '2' } },
      { budget: { currency: 'GBP' } },
      { quietHours: { from: '25:00' } },
      { quietHours: { from: '7:30' } },
      { notifications: { reviewAt: 'morning' } },
      { notifications: { push: true } },
      { remember: 'yes' },
      { appearance: 'light' },
      { token: 'x' },
      { apiKey: 'sk-1234' },
      [],
      'text',
    ];
    for (const body of bad)
      expect(
        (await api('/api/settings', { method: 'PUT', body })).status,
        JSON.stringify(body),
      ).toBe(400);
    expect((await api('/api/settings', { method: 'PUT', raw: '{nope' })).status).toBe(400);
    expect((await api('/api/settings')).json.prefs.trust).toBe('ask');
    expect(() => statSync(join(home, 'web-prefs.json'))).toThrow();
    expect(
      (await api('/api/settings', { method: 'PUT', body: { appearance: 'dark' } })).status,
    ).toBe(200);
  });

  it('refuses a body over 64 KB', async () => {
    const { api } = await serve([]);
    const raw = JSON.stringify({ x: 'a'.repeat(70_000) });
    expect((await api('/api/settings', { method: 'PUT', raw })).status).toBe(413);
  });

  it('ignores a damaged or foreign file and returns defaults', async () => {
    writeFileSync(join(home, 'web-prefs.json'), '{"trust":"root","token":"abc"}');
    const { api } = await serve([]);
    expect((await api('/api/settings')).json.prefs.trust).toBe('ask');
  });

  it('never returns the token or its hash', async () => {
    const { api } = await serve([]);
    await api('/api/settings', { method: 'PUT', body: { quiet: true } });
    const text = (await api('/api/settings')).text;
    expect(text).not.toContain(token);
    expect(text).not.toContain(serveTokenHash(home) as string);
    expect(text).not.toMatch(/sk-|api[_-]?key|secret/i);
  });

  it('applies the chosen trust and cost stop to new tasks, and a request still wins', async () => {
    const { api, store } = await serve([
      call('finish', { answer: 'a' }),
      call('finish', { answer: 'b' }),
    ]);
    await api('/api/settings', {
      method: 'PUT',
      body: { trust: 'steady', budget: { perTask: 0.25, monthly: 0.1 } },
    });
    type Cfg = { config: { permissions: { trust?: string }; budget: { maxCostUsd: number } } };
    const a = await api('/api/tasks', { method: 'POST', body: { prompt: 'one' } });
    const cfg = (await store.read(a.json.taskId))[0]?.event as unknown as Cfg;
    expect(cfg.config.permissions.trust).toBe('steady');
    expect(cfg.config.budget.maxCostUsd).toBe(0.1); // never more than the monthly cap
    const b = await api('/api/tasks', { method: 'POST', body: { prompt: 'two', trust: 'ask' } });
    const cfg2 = (await store.read(b.json.taskId))[0]?.event as unknown as Cfg;
    expect(cfg2.config.permissions.trust).toBeUndefined();
  });
});

describe('home', () => {
  it('has the right shape with no tasks, and invents nothing', async () => {
    const { api } = await serve([]);
    const r = await api('/api/home');
    expect(r.status).toBe(200);
    expect(r.json.status).toMatchObject({
      running: 0,
      machinesUp: 0,
      notes: 0,
      trust: 'ask',
      quiet: false,
    });
    expect(r.json.status.time).toMatch(/^\d\d:\d\d$/);
    expect(r.json.briefing.headline).toBe('Nothing needs you.');
    expect(r.json.briefing.asks).toEqual([]);
    expect(r.json).toMatchObject({
      satellites: [],
      needsYou: [],
      working: [],
      noticed: [],
      alert: null,
      brain: null,
    });
  });

  it('shows cards, working tasks with a step rail, and what ended', async () => {
    const { api, store } = await serve(
      [
        call('note', { text: 'Hello <b>Dana</b>' }),
        call('ask_user', { question: 'Which flight?' }),
        call('finish', { answer: 'All done.' }),
      ],
      { machines: 2, notes: ['n1', 'n2', 'n3'] },
    );
    await api('/api/settings', { method: 'PUT', body: { trust: 'steady', quiet: true } });
    const one = (await api('/api/tasks', { method: 'POST', body: { prompt: 'Email Dana' } })).json
      .taskId;
    await until(async () => (await api(`/api/tasks/${one}`)).json.status === 'waiting_approval');
    const two = (await api('/api/tasks', { method: 'POST', body: { prompt: 'Book a flight' } }))
      .json.taskId;
    await until(async () => (await api(`/api/tasks/${two}`)).json.status === 'waiting_user');
    // A task that is running, with a plan of three steps, one done.
    await store.createTask('task_plan', 'Rename invoices', {
      model: 'scripted',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/w',
    });
    const lease = await store.acquireLease('task_plan', 'test', 60_000);
    if (!lease) throw new Error('no lease');
    const steps = [
      { text: 'Find the files', status: 'done' },
      { text: 'Rename them', status: 'doing' },
      { text: 'Check', status: 'pending' },
    ];
    await store.append(
      'task_plan',
      1,
      [
        {
          type: 'model.responded',
          step: 1,
          calls: [{ callId: 'c1', tool: 'update_plan', args: { steps }, argsHash: 'h1' }],
          usage: { inTokens: 1, outTokens: 1 },
          costUsd: 0.02,
          latencyMs: 1,
        },
        { type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' }, risk: 'read' },
        { type: 'tool.started', callId: 'c1', idempotencyKey: 'c1', attempt: 1 },
        {
          type: 'tool.completed',
          callId: 'c1',
          result: { ok: true, content: 'ok', trust: 'trusted' },
          latencyMs: 1,
        },
      ],
      lease,
    );
    await store.releaseLease(lease);

    const r = await api('/api/home');
    expect(r.status).toBe(200);
    expect(r.json.status).toMatchObject({
      running: 1,
      machinesUp: 2,
      notes: 3,
      trust: 'steady',
      quiet: true,
    });
    expect(r.json.briefing.headline).toBe('2 things need you.');
    const card = r.json.needsYou.find((c: { taskId: string }) => c.taskId === one);
    expect(card).toMatchObject({ kind: 'send as user', title: 'Email Dana' });
    expect(card.detail).toContain('Send: Hello');
    expect(card.approval.callId).toBeTruthy();
    expect(card.approval.argsHash).toBeTruthy();
    const ask = r.json.needsYou.find((c: { taskId: string }) => c.taskId === two);
    expect(ask).toMatchObject({ kind: 'question', detail: 'Which flight?' });
    expect(ask.approval).toBeUndefined();
    expect(r.json.working).toEqual([
      {
        taskId: 'task_plan',
        title: 'Rename invoices',
        state: 'working',
        done: 1,
        total: 3,
        line: 'Rename them',
      },
    ]);
    expect(r.json.brain).toEqual({ notes: 3, newToday: 3, connected: [] });

    // Answer the question: it finishes and shows up under Noticed.
    await api(`/api/tasks/${two}/answer`, { body: { answer: 'The 9am' } });
    await until(async () => (await api(`/api/tasks/${two}`)).json.status === 'succeeded');
    const after = await api('/api/home');
    expect(after.json.noticed).toHaveLength(1);
    expect(after.json.noticed[0].text).toBe('Finished: Book a flight');
    expect(after.json.noticed[0].at).toMatch(/^\d\d:\d\d$/);
    expect(after.json.briefing.headline).toBe('1 thing needs you.');
  });

  it('cleans task text and never sends markup or control characters', async () => {
    const { api } = await serve([call('ask_user', { question: 'Go?\u0007\u001b[31m now' })]);
    const id = (
      await api('/api/tasks', {
        method: 'POST',
        body: { prompt: 'Line one\nline <script>x</script>' },
      })
    ).json.taskId;
    await until(async () => (await api(`/api/tasks/${id}`)).json.status === 'waiting_user');
    const r = await api('/api/home');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is what is checked
    expect(r.text).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect(r.json.needsYou[0].title).toBe('Line one line <script>x</script>');
  });
});

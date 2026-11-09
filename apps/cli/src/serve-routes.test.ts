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

const ROUTES: [string, string][] = [
  ['GET', '/api/settings'],
  ['PUT', '/api/settings'],
];

describe('every new route', () => {
  it('needs the bearer token and sends no CORS headers', async () => {
    const { api, s } = await serve([]);
    for (const [method, path] of ROUTES) {
      expect((await api(path, { method, token: null })).status, path).toBe(401);
      expect((await api(path, { method, token: 'wrong' })).status, path).toBe(401);
    }
    const res = await fetch(`http://127.0.0.1:${s.port}/api/settings`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' },
    });
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control'))).toEqual([]);
  });

  it('answers a wrong method with 405', async () => {
    const { api } = await serve([]);
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

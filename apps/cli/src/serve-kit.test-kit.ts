// A real `remy serve` on a free port, for the route tests: a fake model, an in-memory event store
// and a temp REMY_HOME. Not shipped (excluded from the build with the tests).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntime,
  DEFAULT_BUDGET,
  type ModelResponse,
  type Tool,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { listenServe, type ServeListening } from './serve.ts';
import type { Mount } from './serve-mount.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';

const usage = { inTokens: 10, outTokens: 10 };
const done: ModelResponse = { calls: [{ tool: 'finish', args: { answer: 'Done.' } }], usage };

export interface Kit {
  home: string;
  token: string;
  base: string;
  store: MemoryEventStore;
  serving: ServeListening;
  /** A request with the token (or without, with `token: null`). */
  api(
    path: string,
    o?: { method?: string; token?: string | null; body?: unknown; raw?: string },
  ): Promise<{
    status: number;
    // biome-ignore lint/suspicious/noExplicitAny: a loose view of JSON, for assertions
    json: Record<string, any>;
    text: string;
  }>;
  close(): Promise<void>;
}

export interface KitOptions {
  /** The model's answers, in order (default: finish at once, twenty times). */
  script?: ModelResponse[];
  /** Tools besides `finish`. */
  tools?: Tool[];
  /** The built web app to serve. */
  webRoot?: string;
}

export async function startKit(
  make: (home: string) => Mount[],
  opts: KitOptions = {},
): Promise<Kit> {
  const home = mkdtempSync(join(tmpdir(), 'remy-serve-kit-'));
  const token = makeServeToken(home);
  const store = new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient(opts.script ?? Array.from({ length: 20 }, () => done)),
    tools: new ToolRegistry([finish, ...(opts.tools ?? [])]),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
  });
  const serving = await listenServe(
    {
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
      // Many wrong-token requests in one test must stay 401, not turn into a lockout.
      lockout: { blocked: () => false, fail: () => {} },
      log: () => {},
      pollMs: 20,
      busyMs: 50,
      mounts: make(home),
      ...(opts.webRoot && { webRoot: opts.webRoot }),
    },
    { host: '127.0.0.1', port: 0 },
  );
  const base = `http://127.0.0.1:${serving.port}`;
  return {
    home,
    token,
    base,
    store,
    serving,
    async api(path, o = {}) {
      const t = o.token === undefined ? token : o.token;
      const res = await fetch(`${base}${path}`, {
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
    },
    async close() {
      await serving.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

// `remy serve` with nothing set up: it must start, sign the person in, and ask for a key in the browser.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';

const KEY = 'sk-first-run-ABCDEF1234567890';
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-firstrun-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function boot(fetchImpl?: typeof fetch) {
  let stop: () => void = () => {};
  const serveStop = new Promise<void>((r) => {
    stop = r;
  });
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    // No REMY_PROFILE, no key anywhere: a machine that has never been set up.
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off' },
    cwd: home,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    serveStop,
    ...(fetchImpl && { fetch: fetchImpl }),
  };
  const running = cli(['serve', '--port', '0'], deps);
  for (let i = 0; i < 300 && !/listens on/.test(o.out); i++)
    await new Promise((r) => setTimeout(r, 10));
  const port = Number(/listens on http:\/\/127\.0\.0\.1:(\d+)/.exec(o.out)?.[1]);
  const token = readFileSync(join(home, 'serve-token-first-run.txt'), 'utf8').trim();
  const api = (path: string, body?: object) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    }).then(async (r) => ({
      status: r.status, // biome-ignore lint/suspicious/noExplicitAny: a loose view of JSON, for assertions
      json: (await r.json()) as Record<string, any>,
    }));
  return {
    o,
    port,
    api,
    stop: async () => {
      stop();
      return running;
    },
  };
}

describe('remy serve with no model', () => {
  it('starts, says it has no model, and refuses a task with the next step', async () => {
    const s = await boot();
    expect(s.port).toBeGreaterThan(0);
    expect(s.o.err).toBe('');
    const setup = await s.api('/api/setup/model');
    expect(setup.json.ready).toBe(false);
    expect(setup.json.choices.length).toBeGreaterThan(2);
    const task = await s.api('/api/tasks', { prompt: 'hello' });
    expect(task.status).toBe(409);
    expect(task.json.error).toBe(
      'Remy needs a model before it can answer. Add a key to get started.',
    );
    const settings = await s.api('/api/settings');
    expect(settings.json.providers).toEqual([]);
    expect(settings.json.models.everyday).toBe('none');
    expect((await s.stop()).valueOf()).toBe(0);
  }, 15_000);

  it('a wrong key typed in the browser is refused and nothing is saved', async () => {
    const calls: string[] = [];
    const s = await boot((async (url: string) => {
      calls.push(String(url));
      return new Response('{}', { status: 401 });
    }) as typeof fetch);
    const r = await s.api('/api/setup/model', { provider: 'openai', key: KEY });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/OpenAI did not accept that key/);
    expect(JSON.stringify(r.json)).not.toContain(KEY);
    expect(calls).toEqual(['https://api.openai.com/v1/models']);
    expect(existsSync(join(home, 'credentials.json'))).toBe(false);
    expect(s.o.out + s.o.err).not.toContain(KEY);
    await s.stop();
  }, 15_000);
});

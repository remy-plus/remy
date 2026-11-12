import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fold, type ModelResponse } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { announceFirstRunToken, FIRST_RUN_TOKEN_FILE, serveTokenHash } from './serve-token.ts';
import { sha256Hex } from './webhook-token.ts';

const usage = { inTokens: 100, outTokens: 20 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-servecli-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function harness(extra: Partial<CliDeps> = {}, env: Record<string, string> = {}) {
  const store = new MemoryEventStore();
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home, REMY_KEYCHAIN: 'off', ...env },
    cwd: home,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store,
    ...extra,
  };
  const run = async (...argv: string[]) => {
    o.out = '';
    o.err = '';
    const code = await cli(argv, deps);
    return { code, out: o.out, err: o.err };
  };
  return { run, store, o };
}

describe('remy serve token', () => {
  it('prints a token once and keeps only its hash', async () => {
    const h = harness();
    const first = await h.run('serve', 'token');
    expect(first.code).toBe(0);
    const token = first.out.split('\n')[0] as string;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(serveTokenHash(home)).toBe(sha256Hex(token));
    expect(readFileSync(join(home, 'serve-token.sha256'), 'utf8')).not.toContain(token);

    const again = await h.run('serve', 'token');
    expect(again.out).not.toContain(token);
    expect(again.out).toContain('--rotate');
    expect(serveTokenHash(home)).toBe(sha256Hex(token));

    const rotated = await h.run('serve', 'token', '--rotate');
    const next = rotated.out.split('\n')[0] as string;
    expect(next).not.toBe(token);
    expect(serveTokenHash(home)).toBe(sha256Hex(next));
  });
});

describe('first-run token', () => {
  it('is printed on a terminal and written to a 0600 file elsewhere', () => {
    const lines: string[] = [];
    announceFirstRunToken(home, 'tok-tty', true, (l) => lines.push(l));
    expect(lines[0]).toBe('tok-tty');
    expect(existsSync(join(home, FIRST_RUN_TOKEN_FILE))).toBe(false);

    lines.length = 0;
    announceFirstRunToken(home, 'tok-log', false, (l) => lines.push(l));
    expect(lines.join('\n')).not.toContain('tok-log');
    expect(lines.join('\n')).toContain(join(home, FIRST_RUN_TOKEN_FILE));
    expect(lines.join('\n')).toContain('delete');
    expect(readFileSync(join(home, FIRST_RUN_TOKEN_FILE), 'utf8').trim()).toBe('tok-log');
    expect(statSync(join(home, FIRST_RUN_TOKEN_FILE)).mode & 0o777).toBe(0o600);
  });
});

describe('remy serve', () => {
  it('refuses a non-loopback host without REMY_SERVE_ALLOW_REMOTE=on', async () => {
    const h = harness({ model: new ScriptedModelClient([]) });
    const r = await h.run('serve', '--host', '0.0.0.0', '--port', '0');
    expect(r.code).toBe(1);
    expect(r.err).toContain('REMY_SERVE_ALLOW_REMOTE');
    // Not even the webhook switch opens it.
    const w = harness({ model: new ScriptedModelClient([]) }, { REMY_WEBHOOK_ALLOW_REMOTE: 'on' });
    expect((await w.run('serve', '--host', '192.168.1.5')).code).toBe(1);
  });

  it('serves a task through the real runtime and stops when told to', async () => {
    let stop: () => void = () => {};
    const serveStop = new Promise<void>((r) => {
      stop = r;
    });
    const model = new ScriptedModelClient([call('finish', { answer: 'Hello from serve.' })]);
    const h = harness({ model, serveStop });
    const running = h.run('serve', '--port', '0');
    const started = async () => {
      for (let i = 0; i < 200; i++) {
        const m = /listens on http:\/\/127\.0\.0\.1:(\d+)/.exec(h.o.out);
        if (m) return Number(m[1]);
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`serve did not start: ${h.o.out} ${h.o.err}`);
    };
    const port = await started();
    // The first run made a token. Off a terminal it is in a private file, never in the output.
    const tokenFile = join(home, 'serve-token-first-run.txt');
    const token = readFileSync(tokenFile, 'utf8').trim();
    expect(h.o.out).not.toContain(token);
    expect(h.o.out).toContain(tokenFile);
    expect(h.o.out).toContain('--rotate');
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(serveTokenHash(home)).toBe(sha256Hex(token));
    const api = (path: string, body?: object) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: body !== undefined ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/tasks`)).status).toBe(401);
    const made = (await (
      await api('/api/tasks', { prompt: 'say hello', trust: 'steady' })
    ).json()) as {
      taskId: string;
    };
    const text = await (await api(`/api/tasks/${made.taskId}/stream`)).text();
    expect(text).toContain('Hello from serve.');
    const s = fold(await h.store.read(made.taskId));
    expect(s.final).toMatchObject({ status: 'succeeded', answer: 'Hello from serve.' });
    // Same config the CLI uses: its own workspace, and the trust level that was asked for.
    expect(s.config.workspaceDir).toBe(join(home, 'workspaces', made.taskId));
    expect(s.config.permissions.trust).toBe('steady');
    expect(h.o.out).not.toContain(`Bearer ${token}`);
    stop();
    expect((await running).code).toBe(0);
  }, 15_000);
});

// Red-team pass on `remy serve` (2026-11-13). Each test is an attack with a real request against a
// real listening server. The ones that pass are Remy holding; a failing one is a finding.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineTool, type ModelResponse } from '@remy/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openMemory } from './memory.ts';
import { createBrainMount } from './serve-brain.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createSkillsMount } from './serve-skills.ts';
import { openSkills } from './skills.ts';
import { createLockout } from './webhook-lockout.ts';

const usage = { inTokens: 10, outTokens: 10 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });
const done = call('finish', { answer: 'Done.' });

let kit: Kit | undefined;
const scratch: string[] = [];
afterEach(async () => {
  await kit?.close();
  kit = undefined;
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

const effects = { notes: [] as string[] };
const note = defineTool({
  name: 'note',
  description: 'Save a note',
  args: z.object({ text: z.string() }),
  risk: 'write',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 1000,
  maxOutputChars: 1000,
  preview: (a) => `Save note: ${a.text}`,
  execute: async (a) => {
    effects.notes.push(a.text);
    return { ok: true, content: 'saved', trust: 'trusted' };
  },
});

/** A request that can set any header, Host included (fetch cannot), and send odd request targets. */
function raw(
  port: number,
  path: string,
  o: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: o.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(o.body);
  });
}

const until = async <T>(fn: () => Promise<T | false | undefined>, ms = 4000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};

async function start(script?: ModelResponse[]) {
  const web = mkdtempSync(join(tmpdir(), 'remy-rt-web-'));
  scratch.push(web);
  const root = join(web, 'dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(root, 'assets', 'a.js'), 'console.log(1)');
  writeFileSync(join(web, 'secret.txt'), 'TOP-SECRET-OUTSIDE-ROOT');
  const outside = mkdtempSync(join(tmpdir(), 'remy-rt-out-'));
  scratch.push(outside);
  writeFileSync(join(outside, 'loot.txt'), 'TOP-SECRET-OUTSIDE-ROOT');
  symlinkSync(outside, join(root, 'assets', 'link'));
  kit = await startKit(
    (home) => [
      createBrainMount({ memory: openMemory(home) }),
      createSkillsMount({ skills: openSkills(home, join(home, 'project')) }),
    ],
    { tools: [note], webRoot: root, ...(script && { script }) },
  );
  return kit;
}

const port = (k: Kit) => k.serving.port;

describe('red team: serve token', () => {
  it('rejects a missing, wrong, truncated, padded or foreign-scheme token on every kind of route', async () => {
    const k = await start();
    const paths = [
      '/api/tasks',
      '/api/tasks/task_x',
      '/api/tasks/task_x/stream',
      '/api/brain',
      '/api/skills',
    ];
    const bad = [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      `Bearer ${k.token.slice(0, -1)}`,
      `Bearer ${k.token}x`,
      `Bearer ${k.token} extra`,
      `Bearer  ${k.token}`,
      `Basic ${Buffer.from(`remy:${k.token}`).toString('base64')}`,
      `Token ${k.token}`,
      `Bearer ${k.token}\t`,
    ];
    for (const p of paths)
      for (const authorization of bad) {
        const r = await raw(port(k), p, {
          headers: { ...(authorization !== undefined && { authorization }) },
        });
        // A trailing space or tab is dropped by the HTTP parser, so that one is the real token.
        const trimmed = authorization?.replace(/[ \t]+$/, '');
        if (trimmed === `Bearer ${k.token}`) continue;
        expect(r.status, `${p} with ${authorization}`).toBe(401);
        expect(r.text).not.toContain(k.token);
      }
  });

  it('does not take the token from the query string, a cookie or another header', async () => {
    const k = await start();
    for (const [path, headers] of [
      [`/api/tasks?token=${k.token}`, {}],
      [`/api/tasks?access_token=${k.token}&authorization=Bearer%20${k.token}`, {}],
      ['/api/tasks', { cookie: `remy_token=${k.token}; token=${k.token}` }],
      ['/api/tasks', { 'x-remy-token': k.token, 'x-api-key': k.token }],
      ['/api/tasks', { 'proxy-authorization': `Bearer ${k.token}` }],
      [`/api/tasks/x/stream?token=${k.token}`, {}],
    ] as const) {
      const r = await raw(port(k), path, { headers: { ...headers } });
      expect(r.status, path).toBe(401);
    }
  });

  it('keeps the token out of the answer and the log for a wrong-token request', async () => {
    const k = await start();
    const r = await raw(port(k), '/api/tasks', {
      headers: { authorization: 'Bearer SUPERSECRETGUESS123' },
    });
    expect(r.status).toBe(401);
    expect(r.text).not.toContain('SUPERSECRETGUESS123');
    expect(JSON.stringify(r.headers)).not.toContain('SUPERSECRETGUESS123');
  });
});

describe('red team: Host and Origin', () => {
  const rebinding = [
    'evil.com',
    'evil.com:7790',
    'localhost.evil.com',
    'localhost.evil.com:7790',
    '127.0.0.1.evil.com',
    '127.0.0.1@evil.com',
    'localhost:80@evil.com',
    '[::1].evil.com',
    '[::1]evil',
    '0.0.0.0:7790',
    '0.0.0.0',
    '[::]:7790',
    '2130706433',
    '2130706433:7790',
    '0x7f000001',
    '127.1',
    '127.0.0.1:80:80',
    '127.0.0.1:',
    '127.0.0.1:port',
    'localhost.',
    'LOCALHOST.EVIL.COM',
    '127.0.0.1%00.evil.com',
    ' ',
  ];

  it('answers 421 on the API and on the app for every rebinding Host, even with the right token', async () => {
    const k = await start();
    for (const host of rebinding) {
      for (const path of ['/api/tasks', '/api/health', '/', '/assets/a.js']) {
        const r = await raw(port(k), path, {
          headers: { host, authorization: `Bearer ${k.token}` },
        });
        expect(r.status, `${host} ${path}`).toBe(421);
      }
    }
  });

  it('refuses a null, forged, foreign or mismatched Origin and a cross-site fetch, but counts nothing', async () => {
    const k = await start();
    const own = `127.0.0.1:${port(k)}`;
    const origins = [
      'null',
      'http://evil.com',
      'https://127.0.0.1',
      'http://127.0.0.1',
      `http://evil.com:${port(k)}`,
      `http://127.0.0.1.evil.com:${port(k)}`,
      'file://',
      'chrome-extension://abcdef',
      '',
      'not a url',
    ];
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      for (const origin of origins) {
        const r = await raw(port(k), '/api/tasks', {
          method,
          headers: {
            host: own,
            origin,
            authorization: `Bearer ${k.token}`,
            'content-type': 'application/json',
          },
          body: method === 'POST' ? '{"prompt":"x"}' : undefined,
        });
        expect(r.status, `${method} Origin: ${origin}`).toBe(403);
      }
    }
    expect(
      (
        await raw(port(k), '/api/tasks', {
          headers: {
            host: own,
            'sec-fetch-site': 'cross-site',
            authorization: `Bearer ${k.token}`,
          },
        })
      ).status,
    ).toBe(403);
    // No task was started by any of that.
    expect((await k.api('/api/tasks')).json.tasks).toEqual([]);
  });

  it('lets the same origin through, and a request with neither header (a script, not a page)', async () => {
    const k = await start();
    const own = `127.0.0.1:${port(k)}`;
    const same = await raw(port(k), '/api/tasks', {
      headers: { host: own, origin: `http://${own}`, authorization: `Bearer ${k.token}` },
    });
    expect(same.status).toBe(200);
    const bare = await raw(port(k), '/api/tasks', {
      headers: { host: own, authorization: `Bearer ${k.token}` },
    });
    expect(bare.status).toBe(200);
  });

  it('answers a preflight without CORS headers, so no browser will send the real request', async () => {
    const k = await start();
    for (const origin of [undefined, 'http://evil.com', 'null']) {
      const r = await raw(port(k), '/api/tasks', {
        method: 'OPTIONS',
        headers: {
          ...(origin && { origin }),
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect([403, 405]).toContain(r.status);
      const names = Object.keys(r.headers).filter((h) => h.startsWith('access-control-'));
      expect(names).toEqual([]);
    }
  });

  it('sets no CORS header on any answer, error or success', async () => {
    const k = await start();
    for (const [path, headers] of [
      ['/api/health', { origin: 'http://evil.com' }],
      ['/api/tasks', { authorization: `Bearer ${k.token}` }],
      ['/api/nope', { authorization: `Bearer ${k.token}` }],
      ['/api/tasks', {}],
      ['/', {}],
    ] as const) {
      const r = await raw(port(k), path, { headers: { ...headers } });
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    }
  });
});

describe('red team: paths', () => {
  it('serves nothing outside the web root for any climbing, encoding or symlink trick', async () => {
    const k = await start();
    const targets = [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/%252e%252e/secret.txt',
      '/..%252fsecret.txt',
      '/assets/../../secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..%5csecret.txt',
      '/..\\secret.txt',
      '//secret.txt',
      '///..//secret.txt',
      '/assets/link/loot.txt',
      '/assets/link/../loot.txt',
      '/%00/../secret.txt',
      '/secret.txt%00.js',
      '/assets/a.js%00/../../secret.txt',
      '/%c0%ae%c0%ae/secret.txt',
      '/%ef%bc%8e%ef%bc%8e/secret.txt',
      '/assets/a.js/../../secret.txt',
      `http://127.0.0.1:${port(k)}/../secret.txt`,
      '/api/../secret.txt',
      '/api%2f..%2f..%2fsecret.txt',
    ];
    for (const t of targets) {
      const r = await raw(port(k), t, { headers: { host: `127.0.0.1:${port(k)}` } });
      expect(r.text, t).not.toContain('TOP-SECRET-OUTSIDE-ROOT');
      expect(r.status, t).toBeLessThan(500);
    }
  });

  it('answers 4xx, never 500 and never a file, for ids that climb or smuggle a NUL on every route that takes one', async () => {
    const k = await start();
    const ids = [
      '..',
      '.',
      '%2e%2e',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '..%2f..%2f..%2fetc%2fpasswd',
      '%00',
      'a%00b',
      '%2fetc%2fpasswd',
      '..%5c..%5cwindows',
      'x'.repeat(5000),
      '%',
      '%ff',
      '__proto__',
      'constructor',
      'toString',
    ];
    const prefixes = [
      '/api/tasks/',
      '/api/brain/',
      '/api/skills/',
      '/api/skills/directory/',
      '/api/connections/',
      '/api/schedules/',
      '/api/webhooks/',
      '/api/chats/',
    ];
    for (const prefix of prefixes)
      for (const id of ids)
        for (const suffix of ['', '/stream', '/approve', '/enabled', '/run', '/permissions']) {
          for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
            const r = await raw(port(k), `${prefix}${id}${suffix}`, {
              method,
              headers: {
                authorization: `Bearer ${k.token}`,
                ...(method !== 'GET' && { 'content-type': 'application/json' }),
              },
              body: method === 'GET' ? undefined : '{}',
            });
            const label = `${method} ${prefix}${id.slice(0, 30)}${suffix}`;
            // `.` and `..` are folded away by URL parsing (as `/api/tasks/` or the parent), so the
            // route sees the parent; the point is no error, no file.
            if (id !== '.' && id !== '..') expect(r.status, label).toBeGreaterThanOrEqual(400);
            expect(r.status, label).toBeLessThan(500);
            expect(r.text, label).not.toMatch(/root:|\/etc\/passwd|node_modules/);
          }
        }
  });

  it('does not treat a path-looking task id as a different task', async () => {
    const k = await start();
    const a = (await k.api('/api/tasks', { body: { prompt: 'first' } })).json.taskId as string;
    for (const id of [`${a}%2f..%2f${a}`, `${a}.`, `${a}%00`, a.toUpperCase()]) {
      const r = await k.api(`/api/tasks/${id}`);
      expect([400, 404], id).toContain(r.status);
    }
  });
});

describe('red team: bodies', () => {
  it('stops reading a body that never ends (chunked, no length), with no task started', async () => {
    const k = await start();
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: port(k),
          path: '/api/tasks',
          method: 'POST',
          headers: {
            authorization: `Bearer ${k.token}`,
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', () => resolve(0));
      const chunk = Buffer.alloc(16 * 1024, 0x20);
      let sent = 0;
      const pump = () => {
        while (sent < 4 * 1024 * 1024 && !req.destroyed) {
          sent += chunk.length;
          if (!req.write(chunk)) return void req.once('drain', pump);
        }
        req.end();
      };
      pump();
    });
    expect([0, 413]).toContain(status);
    expect((await k.api('/api/tasks')).json.tasks).toEqual([]);
  });

  it('answers 400 for a deeply nested or huge-number JSON body, not a crash', async () => {
    const k = await start();
    const deep = `${'['.repeat(30_000)}${']'.repeat(30_000)}`;
    for (const raw of [deep, '{"prompt":"x","n":1e999999}', `{"prompt":"${'a'.repeat(30_000)}"}`]) {
      const r = await k.api('/api/tasks', { raw });
      expect([400, 413], raw.slice(0, 20)).toContain(r.status);
    }
    expect((await k.api('/api/health')).status).toBe(200);
  });

  it('rejects __proto__ and constructor keys, and leaves Object.prototype alone', async () => {
    const k = await start();
    const bodies = [
      '{"prompt":"x","__proto__":{"polluted":"yes"}}',
      '{"__proto__":{"polluted":"yes"},"prompt":"x"}',
      '{"prompt":"x","constructor":{"prototype":{"polluted":"yes"}}}',
      '{"prompt":"x","trust":"ask","__proto__":{"trust":"away"}}',
    ];
    for (const body of bodies) {
      for (const path of ['/api/tasks', '/api/brain', '/api/skills/x/enabled']) {
        const r = await k.api(path, { method: path === '/api/brain' ? 'PUT' : 'POST', raw: body });
        expect(r.status, `${path} ${body}`).toBeLessThan(500);
      }
    }
    const r = await k.api('/api/tasks', { raw: bodies[0] as string });
    expect(r.status).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    expect((await k.api('/api/tasks')).json.tasks).toEqual([]);
  });
});

describe('red team: one task cannot read or steer another', () => {
  it('streams only the asked-for task, whatever Last-Event-ID says', async () => {
    const k = await start();
    const a = (await k.api('/api/tasks', { body: { prompt: 'ALPHA-PRIVATE-PROMPT' } })).json
      .taskId as string;
    const b = (await k.api('/api/tasks', { body: { prompt: 'BRAVO-PRIVATE-PROMPT' } })).json
      .taskId as string;
    await until(async () => (await k.api(`/api/tasks/${a}`)).json.status === 'succeeded');
    await until(async () => (await k.api(`/api/tasks/${b}`)).json.status === 'succeeded');
    for (const last of [undefined, '0', '99999999', '-1', 'abc', '1e3', `${b}`]) {
      const r = await raw(port(k), `/api/tasks/${a}/stream`, {
        headers: {
          authorization: `Bearer ${k.token}`,
          ...(last !== undefined && { 'last-event-id': last }),
        },
      });
      expect(r.status).toBe(200);
      expect(r.text).not.toContain('BRAVO-PRIVATE-PROMPT');
    }
    const q = await raw(port(k), `/api/tasks/${a}/stream?lastEventId=${b}`, {
      headers: { authorization: `Bearer ${k.token}` },
    });
    expect(q.text).not.toContain('BRAVO-PRIVATE-PROMPT');
    expect((await k.api(`/api/tasks/${a}`)).text).not.toContain('BRAVO-PRIVATE-PROMPT');
  });
});

describe('red team: approvals over HTTP', () => {
  const noteScript = (text: string) => [call('note', { text }), done];

  async function waiting(k: Kit, text: string) {
    const id = (await k.api('/api/tasks', { body: { prompt: `note ${text}` } })).json
      .taskId as string;
    const w = await until(async () => {
      const v = await k.api(`/api/tasks/${id}`);
      return v.json.status === 'waiting_approval' && v.json;
    });
    return { id, ...(w.pendingApproval as { callId: string; argsHash: string; preview: string }) };
  }

  it('does not let an approval for one set of arguments run another', async () => {
    effects.notes = [];
    // Two tasks ask for different notes; each card has its own hash.
    const k = await start([
      call('note', { text: 'harmless' }),
      call('note', { text: 'HARMFUL' }),
      done,
      done,
    ]);
    const a = await waiting(k, 'a');
    const b = await waiting(k, 'b');
    expect(a.argsHash).not.toBe(b.argsHash);
    // Approve B's card with A's hash, and A's card with B's hash, and with a hash of nothing.
    for (const [t, h] of [
      [b, a.argsHash],
      [a, b.argsHash],
      [a, ''],
      [a, 'x'.repeat(200)],
      [a, a.argsHash.toUpperCase()],
      [a, ` ${a.argsHash}`],
    ] as const) {
      const r = await k.api(`/api/tasks/${t.id}/approve`, {
        body: { callId: t.callId, argsHash: h, granted: true },
      });
      expect([400, 409], `${t.preview} with ${h.slice(0, 8)}`).toContain(r.status);
    }
    expect(effects.notes).toEqual([]);
  });

  it('does not let a card of one task be answered through another task', async () => {
    effects.notes = [];
    const k = await start([
      call('note', { text: 'same' }),
      call('note', { text: 'same' }),
      done,
      done,
    ]);
    const a = await waiting(k, 'a');
    const b = await waiting(k, 'b');
    // Same arguments, same hash. B's call id on A's route, or a made-up task, does nothing.
    const wrongTask = await k.api(`/api/tasks/${a.id}/approve`, {
      body: { callId: `${b.callId}-other`, argsHash: b.argsHash, granted: true },
    });
    expect(wrongTask.status).toBe(409);
    const ghost = await k.api('/api/tasks/task_doesnotexist/approve', {
      body: { callId: a.callId, argsHash: a.argsHash, granted: true },
    });
    expect(ghost.status).toBe(404);
    expect(effects.notes).toEqual([]);
    // Approving A runs A only; B is still waiting.
    expect(
      (
        await k.api(`/api/tasks/${a.id}/approve`, {
          body: { callId: a.callId, argsHash: a.argsHash, granted: true },
        })
      ).status,
    ).toBe(200);
    await until(async () => (await k.api(`/api/tasks/${a.id}`)).json.status === 'succeeded');
    expect(effects.notes).toEqual(['same']);
    expect((await k.api(`/api/tasks/${b.id}`)).json.status).toBe('waiting_approval');
  });

  it('keeps a denial final: a later grant for the same card does nothing', async () => {
    effects.notes = [];
    const k = await start(noteScript('denied'));
    const a = await waiting(k, 'a');
    expect(
      (
        await k.api(`/api/tasks/${a.id}/approve`, {
          body: { callId: a.callId, argsHash: a.argsHash, granted: false },
        })
      ).status,
    ).toBe(200);
    await until(async () => (await k.api(`/api/tasks/${a.id}`)).json.status === 'succeeded');
    const late = await k.api(`/api/tasks/${a.id}/approve`, {
      body: { callId: a.callId, argsHash: a.argsHash, granted: true },
    });
    expect(late.status).toBe(409);
    await new Promise((r) => setTimeout(r, 100));
    expect(effects.notes).toEqual([]);
  });

  it('runs a granted call once, however many grants arrive at the same moment', async () => {
    effects.notes = [];
    const k = await start(noteScript('once'));
    const a = await waiting(k, 'a');
    const body = { callId: a.callId, argsHash: a.argsHash, granted: true };
    await Promise.all(
      Array.from({ length: 8 }, () => k.api(`/api/tasks/${a.id}/approve`, { body })),
    );
    await until(async () => (await k.api(`/api/tasks/${a.id}`)).json.status === 'succeeded');
    await new Promise((r) => setTimeout(r, 100));
    expect(effects.notes).toEqual(['once']);
  });

  it('needs the token to approve, and a cross-site page cannot', async () => {
    effects.notes = [];
    const k = await start(noteScript('nope'));
    const a = await waiting(k, 'a');
    const body = JSON.stringify({ callId: a.callId, argsHash: a.argsHash, granted: true });
    const own = `127.0.0.1:${port(k)}`;
    for (const headers of [
      {},
      { origin: 'http://evil.com' },
      { origin: 'null', authorization: `Bearer ${k.token}` },
      { 'sec-fetch-site': 'cross-site', authorization: `Bearer ${k.token}` },
      { host: 'evil.com', authorization: `Bearer ${k.token}` },
      { authorization: 'Bearer wrong' },
    ]) {
      const r = await raw(port(k), `/api/tasks/${a.id}/approve`, {
        method: 'POST',
        headers: { host: own, 'content-type': 'text/plain', ...headers },
        body,
      });
      expect([401, 403, 421], JSON.stringify(headers)).toContain(r.status);
    }
    expect(effects.notes).toEqual([]);
    expect((await k.api(`/api/tasks/${a.id}`)).json.status).toBe('waiting_approval');
  });

  it('does not accept a loose approval body (string "true", extra fields, an array)', async () => {
    effects.notes = [];
    const k = await start(noteScript('loose'));
    const a = await waiting(k, 'a');
    for (const body of [
      { callId: a.callId, argsHash: a.argsHash, granted: 'true' },
      { callId: a.callId, argsHash: a.argsHash, granted: 1 },
      { callId: a.callId, argsHash: a.argsHash, granted: true, by: 'user' },
      { callId: a.callId, argsHash: a.argsHash, granted: true, always: 'yes' },
      { callId: [a.callId], argsHash: a.argsHash, granted: true },
      [{ callId: a.callId, argsHash: a.argsHash, granted: true }],
    ]) {
      const r = await k.api(`/api/tasks/${a.id}/approve`, { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(effects.notes).toEqual([]);
  });
});

describe('red team: the lockout', () => {
  it('cannot be set off by a web page, and cannot be dodged with a forwarded address', async () => {
    kit = await startKit(() => [], { lockout: createLockout(Date.now, 60_000) });
    const k = kit;
    const own = `127.0.0.1:${port(k)}`;
    // A page cannot lock the person out: its requests are refused before the token is looked at.
    for (let i = 0; i < 20; i++) {
      const r = await raw(port(k), '/api/tasks', {
        headers: {
          host: own,
          origin: 'http://evil.com',
          'sec-fetch-site': 'cross-site',
          authorization: `Bearer wrong-${i}`,
        },
      });
      expect(r.status).toBe(403);
    }
    const fine = await raw(port(k), '/api/tasks', {
      headers: { authorization: `Bearer ${k.token}` },
    });
    expect(fine.status).toBe(200);
    // A guesser cannot get a fresh allowance by claiming to be someone else.
    for (let i = 0; i < 5; i++)
      await raw(port(k), '/api/tasks', {
        headers: {
          authorization: `Bearer guess-${i}`,
          'x-forwarded-for': `10.0.0.${i}`,
          forwarded: `for=10.9.9.${i}`,
        },
      });
    const locked = await raw(port(k), '/api/tasks', {
      headers: {
        authorization: `Bearer ${k.token}`,
        'x-forwarded-for': '10.1.2.3',
        'x-real-ip': '10.4.5.6',
      },
    });
    expect(locked.status).toBe(429);
  });
});

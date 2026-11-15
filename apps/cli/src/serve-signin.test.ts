// One-time sign-in codes: the code store, and POST /api/session/exchange through a real listener.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listenServe, type ServeListening } from './serve.ts';
import { createSignInCodes, SIGN_IN_CODE_TTL_MS, signInLink } from './serve-signin.ts';
import { makeServeToken, makeSession, serveTokenHash, sessionHashes } from './serve-token.ts';
import { sha256Hex } from './webhook-token.ts';

describe('createSignInCodes', () => {
  it('works once', () => {
    const codes = createSignInCodes();
    const code = codes.mint();
    expect(codes.redeem(code)).toBe(true);
    expect(codes.redeem(code)).toBe(false);
  });

  it('refuses a wrong code and keeps the right one usable', () => {
    const codes = createSignInCodes();
    const code = codes.mint();
    expect(codes.redeem('nope')).toBe(false);
    expect(codes.redeem('')).toBe(false);
    expect(codes.redeem(code)).toBe(true);
  });

  it('refuses everything when no code was made', () => {
    expect(createSignInCodes().redeem('anything')).toBe(false);
  });

  it('expires after ten minutes, and an expired code is used up', () => {
    let t = 1_000;
    const codes = createSignInCodes(() => t);
    const code = codes.mint();
    t += SIGN_IN_CODE_TTL_MS - 1;
    expect(codes.redeem(code)).toBe(true);
    const late = codes.mint();
    t += SIGN_IN_CODE_TTL_MS + 1;
    expect(codes.redeem(late)).toBe(false);
    expect(codes.redeem(late)).toBe(false);
  });

  it('lets a new code replace the old one', () => {
    const codes = createSignInCodes();
    const first = codes.mint();
    const second = codes.mint();
    expect(codes.redeem(first)).toBe(false);
    expect(codes.redeem(second)).toBe(true);
  });

  it('puts the code after the # so a browser never sends it', () => {
    expect(signInLink('127.0.0.1', 7790, 'abc')).toBe('http://127.0.0.1:7790/#/sign-in?code=abc');
    expect(signInLink('::1', 7790, 'abc')).toBe('http://[::1]:7790/#/sign-in?code=abc');
  });
});

let home: string;
let token: string;
let open: ServeListening[] = [];
let logs: string[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-signin-'));
  token = makeServeToken(home);
  logs = [];
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

async function start(withSignIn = true, codes = createSignInCodes()) {
  const store = new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient([]),
    tools: new ToolRegistry([finish]),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
  });
  const s = await listenServe(
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
      sessionHashes: () => sessionHashes(home),
      ...(withSignIn && { signIn: { codes, session: () => makeSession(home) } }),
      log: (line) => logs.push(line),
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  return { s, codes };
}

interface Reply {
  status: number;
  json: { token?: string; error?: string };
  text: string;
}
const post = (
  port: number,
  body: string,
  headers: Record<string, string> = {},
  path = '/api/session/exchange',
  method = 'POST',
) =>
  new Promise<Reply>((resolve, reject) => {
    const r = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          text += c;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    r.on('error', reject);
    r.end(body);
  });
const exchange = (port: number, code: string, headers: Record<string, string> = {}) =>
  post(port, JSON.stringify({ code }), headers);
const tasks = (port: number, bearer: string) =>
  post(port, '', { authorization: `Bearer ${bearer}` }, '/api/tasks', 'GET');

describe('POST /api/session/exchange', () => {
  it('trades the code for a session that works, and the main token still works', async () => {
    const { s, codes } = await start();
    const r = await exchange(s.port, codes.mint());
    expect(r.status).toBe(200);
    const session = r.json.token as string;
    expect(session.length).toBeGreaterThanOrEqual(43);
    expect(session).not.toBe(token);
    expect((await tasks(s.port, session)).status).toBe(200);
    expect((await tasks(s.port, token)).status).toBe(200);
    expect((await tasks(s.port, 'wrong')).status).toBe(401);
  });

  it('keeps only the hash of the session, in a 0600 file', async () => {
    const { s, codes } = await start();
    const session = (await exchange(s.port, codes.mint())).json.token as string;
    const file = join(home, 'serve-sessions.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = readFileSync(file, 'utf8');
    expect(saved).not.toContain(session);
    expect(saved).toContain(sha256Hex(session));
    expect(readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a second use of the same code', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    expect((await exchange(s.port, code)).status).toBe(200);
    const again = await exchange(s.port, code);
    expect(again.status).toBe(401);
    expect(again.json.token).toBeUndefined();
    expect(again.json.error).toMatch(/expired or was already used/);
  });

  it('refuses a wrong code, and a wrong guess does not use up the right one', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    expect((await exchange(s.port, 'not-the-code')).status).toBe(401);
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('refuses an expired code', async () => {
    let t = 0;
    const clocked = createSignInCodes(() => t);
    const { s } = await start(true, clocked);
    const code = clocked.mint();
    t += SIGN_IN_CODE_TTL_MS + 1;
    expect((await exchange(s.port, code)).status).toBe(401);
    expect(existsSync(join(home, 'serve-sessions.json'))).toBe(false);
  });

  it('counts wrong codes toward the lockout, which then blocks even the right code', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    for (let i = 0; i < 5; i++) expect((await exchange(s.port, `bad${i}`)).status).toBe(401);
    expect((await exchange(s.port, code)).status).toBe(429);
    expect((await tasks(s.port, token)).status).toBe(429);
  });

  it('refuses a cross-site POST with 403 and leaves the code usable', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    expect((await exchange(s.port, code, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await exchange(s.port, code, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await exchange(s.port, code, { origin: 'null' })).status).toBe(403);
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('keeps the Host check: another host gets 421 and the code stays usable', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    expect((await exchange(s.port, code, { host: 'evil.example' })).status).toBe(421);
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('takes only POST with a plain JSON body', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    expect((await post(s.port, '', {}, '/api/session/exchange', 'GET')).status).toBe(405);
    expect((await post(s.port, 'not json')).status).toBe(400);
    expect((await post(s.port, JSON.stringify({ code, extra: 1 }))).status).toBe(400);
    expect((await post(s.port, JSON.stringify({ code: 5 }))).status).toBe(400);
    expect((await exchange(s.port, code)).status).toBe(200);
  });

  it('never writes the code or a session token to the log', async () => {
    const { s, codes } = await start();
    const code = codes.mint();
    await exchange(s.port, 'wrong-one');
    const session = (await exchange(s.port, code)).json.token as string;
    await exchange(s.port, code);
    const log = logs.join('\n');
    expect(log).toContain('/api/session/exchange');
    expect(log).not.toContain(code);
    expect(log).not.toContain(session);
    expect(log).not.toContain('wrong-one');
  });

  it('does not exist when the server has no sign-in codes', async () => {
    const { s } = await start(false);
    expect((await exchange(s.port, 'x')).status).toBe(401); // falls to the token check
  });

  it('is cleared when the access token is rotated', async () => {
    const { s, codes } = await start();
    const session = (await exchange(s.port, codes.mint())).json.token as string;
    expect((await tasks(s.port, session)).status).toBe(200);
    makeServeToken(home);
    expect((await tasks(s.port, session)).status).toBe(401);
  });

  it('keeps at most ten sessions, dropping the oldest', () => {
    const tokens = Array.from({ length: 12 }, () => makeSession(home));
    const hashes = sessionHashes(home);
    expect(hashes).toHaveLength(10);
    expect(hashes).not.toContain(sha256Hex(tokens[0] as string));
    expect(hashes).toContain(sha256Hex(tokens[11] as string));
  });
});

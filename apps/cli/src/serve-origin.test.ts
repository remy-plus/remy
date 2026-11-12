// Host, Origin and lockout rules of `remy serve`: rebinding, cross-site pages and token lockout abuse.
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostAllowed, listenServe, ownHosts, type ServeListening } from './serve.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';

let home: string;
let token: string;
let open: ServeListening[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-origin-'));
  token = makeServeToken(home);
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

async function start() {
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
      log: () => {},
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  return s;
}

/** A raw request, so the Host header can be anything. */
const raw = (port: number, path: string, headers: Record<string, string>, method = 'GET') =>
  new Promise<number>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on('error', reject);
    r.end();
  });

describe('Host header', () => {
  it('accepts loopback names with any port and the listed extras only', () => {
    for (const h of ['127.0.0.1:7790', 'localhost:1', '[::1]:7790', 'LOCALHOST:7790'])
      expect(hostAllowed(h), h).toBe(true);
    for (const h of ['evil.example', 'evil.example:7790', '127.0.0.1.evil.example', undefined, ''])
      expect(hostAllowed(h), String(h)).toBe(false);
    expect(hostAllowed('10.0.0.5:7790', ['10.0.0.5:7790'])).toBe(true);
    expect(hostAllowed('10.0.0.5:9', ['10.0.0.5:7790'])).toBe(false);
    expect(hostAllowed('box.tail.ts.net:7790', ['box.tail.ts.net'])).toBe(true);
  });

  it('answers 421 for another host on every route, and 200 for localhost', async () => {
    const s = await start();
    for (const path of ['/', '/api/health', '/api/tasks'])
      expect(await raw(s.port, path, { host: 'evil.example' }), path).toBe(421);
    expect(await raw(s.port, '/api/health', { host: `localhost:${s.port}` })).toBe(200);
    expect(await raw(s.port, '/api/health', { host: `127.0.0.1:${s.port}` })).toBe(200);
  });
});

describe('cross-site requests and the lockout', () => {
  it('refuses a cross-site or foreign-origin request with 403, counting nothing', async () => {
    const s = await start();
    const host = `127.0.0.1:${s.port}`;
    for (let i = 0; i < 8; i++) {
      expect(await raw(s.port, '/api/tasks', { host, 'sec-fetch-site': 'cross-site' })).toBe(403);
      expect(await raw(s.port, '/api/tasks', { host, origin: 'https://evil.example' })).toBe(403);
      expect(await raw(s.port, '/api/tasks', { host, origin: 'null' })).toBe(403);
    }
    expect(await raw(s.port, '/api/tasks', { host, authorization: `Bearer ${token}` })).toBe(200);
  });

  it('lets the web app (same origin) through', async () => {
    const s = await start();
    const host = `127.0.0.1:${s.port}`;
    const h = {
      host,
      origin: `http://${host}`,
      'sec-fetch-site': 'same-origin',
      authorization: `Bearer ${token}`,
    };
    expect(await raw(s.port, '/api/tasks', h)).toBe(200);
  });

  it('does not count preflights or missing tokens, but does count wrong ones', async () => {
    const s = await start();
    const host = `127.0.0.1:${s.port}`;
    for (let i = 0; i < 8; i++) {
      expect(await raw(s.port, '/api/tasks', { host }, 'OPTIONS')).toBe(405);
      expect(await raw(s.port, '/api/tasks', { host })).toBe(401);
    }
    expect(await raw(s.port, '/api/tasks', { host, authorization: `Bearer ${token}` })).toBe(200);
    for (let i = 0; i < 5; i++)
      expect(await raw(s.port, '/api/tasks', { host, authorization: 'Bearer wrong' })).toBe(401);
    expect(await raw(s.port, '/api/tasks', { host, authorization: `Bearer ${token}` })).toBe(429);
  });
});

describe('ownHosts', () => {
  const ifaces = {
    lo0: [{ address: '127.0.0.1' }, { address: '::1' }],
    en0: [{ address: '192.168.1.5' }, { address: 'fe80::1%en0' }, { address: 'FD00::5' }],
    utun: [{ address: '100.64.0.9' }],
  };

  it('on an unspecified bind lists every address and the host names', () => {
    const hosts = ownHosts('0.0.0.0', ifaces, 'MyHost');
    expect(hosts).toEqual(
      expect.arrayContaining(['192.168.1.5', '100.64.0.9', '[fd00::5]', 'myhost', 'myhost.local']),
    );
    expect(hosts.some((h) => h.includes('fe80'))).toBe(false);
  });

  it('adds no .local name when the hostname has a dot', () => {
    const hosts = ownHosts('::', ifaces, 'box.lan');
    expect(hosts).toContain('box.lan');
    expect(hosts).not.toContain('box.lan.local');
  });

  it('on a specific address keeps only that address', () => {
    expect(ownHosts('192.168.1.5', ifaces, 'h')).toEqual(['192.168.1.5']);
    expect(ownHosts('fd00::5', ifaces, 'h')).toEqual(['[fd00::5]']);
  });

  it('feeds hostAllowed on any port and still refuses strangers', () => {
    const hosts = ownHosts('0.0.0.0', ifaces, 'myhost');
    expect(hostAllowed('192.168.1.5:7790', hosts)).toBe(true);
    expect(hostAllowed('MyHost.local:1234', hosts)).toBe(true);
    expect(hostAllowed('[fd00::5]:7790', hosts)).toBe(true);
    expect(hostAllowed('evil.example', hosts)).toBe(false);
    expect(hostAllowed('evil.example:7790', hosts)).toBe(false);
    expect(hostAllowed('192.168.1.99:7790', hosts)).toBe(false);
  });
});

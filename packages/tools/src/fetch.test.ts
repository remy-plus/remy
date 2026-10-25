// Spec for ScopedFetch, fetch_url, web_search, ask_user and redaction (PLAN.md step 8).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ToolContext } from '@remy/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  askUser,
  createRedactor,
  createScopedFetch,
  createWebSearch,
  fetchUrl,
  htmlToText,
  isPrivateAddress,
  NetError,
} from './index.ts';

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<html><head><title>Hi</title><style>p{}</style><script>evil()</script></head>' +
          '<body><h1>Hello &amp; welcome</h1><p>Line one.</p><p>Line two.</p></body></html>',
      );
    } else if (req.url === '/to-internal') {
      res.writeHead(302, { location: `http://internal.test:${port}/page` });
      res.end();
    } else if (req.url === '/to-page') {
      res.writeHead(301, { location: '/page' });
      res.end();
    } else if (req.url === '/big') {
      res.end('x'.repeat(5000));
    } else if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

// Fake DNS: "public.test" points at the local server, which this test treats as public.
const lookup = async (host: string): Promise<string[]> =>
  ({
    'public.test': ['127.0.0.1'],
    'internal.test': ['10.0.0.7'],
    'mixed.test': ['93.184.216.34', '192.168.1.10'],
  })[host] ?? [];
const blockAddress = (ip: string) => ip !== '127.0.0.1' && isPrivateAddress(ip);
const net = (opts: Partial<Parameters<typeof createScopedFetch>[0]> = {}) =>
  createScopedFetch({ lookup, blockAddress, ...opts });
const url = (path: string, host = 'public.test') => `http://${host}:${port}${path}`;

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('ScopedFetch', () => {
  it('fetches an allowed page', async () => {
    const r = await net().get(url('/page'));
    expect(r.status).toBe(200);
    expect(r.contentType).toMatch(/text\/html/);
    expect(r.body).toContain('Hello');
  });

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'file:///etc/passwd',
    'ftp://public.test/',
    'not a url',
  ])('blocks %s with the default guard', async (u) => {
    await expect(createScopedFetch({ lookup }).get(u)).rejects.toBeInstanceOf(NetError);
  });

  it('blocks a DNS name that resolves to a private address', async () => {
    await expect(net().get(url('/page', 'internal.test'))).rejects.toBeInstanceOf(NetError);
    await expect(net().get(url('/page', 'mixed.test'))).rejects.toBeInstanceOf(NetError);
  });

  it('re-checks every redirect hop', async () => {
    await expect(net().get(url('/to-internal'))).rejects.toBeInstanceOf(NetError);
    const r = await net().get(url('/to-page'));
    expect(r.url).toBe(url('/page'));
  });

  it('caps redirects', async () => {
    await expect(net().get(url('/loop'))).rejects.toThrow(/redirect/i);
  });

  it('enforces the domain allowlist', async () => {
    await expect(net({ allow: ['example.com'] }).get(url('/page'))).rejects.toBeInstanceOf(
      NetError,
    );
    expect((await net({ allow: ['public.test'] }).get(url('/page'))).status).toBe(200);
  });

  it('caps response size', async () => {
    await expect(net({ maxBytes: 1000 }).get(url('/big'))).rejects.toThrow(/too large/i);
  });

  it('returns non-2xx responses instead of throwing', async () => {
    expect((await net().get(url('/missing'))).status).toBe(404);
  });
});

describe('htmlToText', () => {
  it('keeps readable text and drops scripts and styles', () => {
    const t = htmlToText(
      '<title>T</title><script>x()</script><style>a{}</style><p>A &amp; B</p><p>C</p>',
    );
    expect(t).toContain('A & B');
    expect(t).toContain('C');
    expect(t).not.toContain('x()');
    expect(t).not.toContain('a{}');
  });
});

const ctx = (n = net()): ToolContext => ({
  taskId: 't',
  callId: 'c',
  idempotencyKey: 't:c',
  signal: new AbortController().signal,
  fs: {
    readText: () => Promise.reject(new Error()),
    writeText: () => Promise.reject(new Error()),
    list: () => Promise.reject(new Error()),
  },
  net: n,
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
});

describe('fetch_url', () => {
  it('is a read tool with untrusted output', () => {
    expect([fetchUrl.risk, fetchUrl.effect, fetchUrl.outputTrust]).toEqual([
      'read',
      'none',
      'untrusted',
    ]);
  });

  it('returns readable text marked untrusted', async () => {
    const r = await fetchUrl.execute({ url: url('/page') }, ctx());
    expect(r).toMatchObject({ ok: true, trust: 'untrusted' });
    expect(r.ok && r.content).toContain('Hello & welcome');
    expect(r.ok && r.content).not.toContain('evil()');
  });

  it('reports blocked URLs as non-retryable errors', async () => {
    const r = await fetchUrl.execute({ url: 'http://169.254.169.254/' }, ctx());
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it('reports HTTP errors', async () => {
    const r = await fetchUrl.execute({ url: url('/missing') }, ctx());
    expect(r).toMatchObject({ ok: false });
  });
});

describe('web_search', () => {
  it('formats provider results as untrusted output', async () => {
    const tool = createWebSearch({
      search: async (q, n) =>
        [{ title: `About ${q}`, url: 'https://a.test', snippet: 'Snippet' }].slice(0, n),
    });
    expect([tool.name, tool.risk, tool.outputTrust]).toEqual(['web_search', 'read', 'untrusted']);
    const r = await tool.execute({ query: 'cats' }, ctx());
    expect(r).toMatchObject({ ok: true, trust: 'untrusted' });
    expect(r.ok && r.content).toContain('About cats');
    expect(r.ok && r.content).toContain('https://a.test');
  });

  it('marks provider failures retryable', async () => {
    const tool = createWebSearch({
      search: async () => {
        throw new Error('503');
      },
    });
    expect(await tool.execute({ query: 'x' }, ctx())).toMatchObject({
      ok: false,
      retryable: true,
      phase: 'before_effect',
    });
  });
});

describe('ask_user', () => {
  it('is a trusted read tool whose preview is the question', () => {
    expect([askUser.name, askUser.risk, askUser.effect]).toEqual(['ask_user', 'read', 'none']);
    expect(askUser.preview({ question: 'Which file?' })).toContain('Which file?');
  });
});

describe('createRedactor', () => {
  it('replaces secret values and ignores short ones', () => {
    const redact = createRedactor({ OPENROUTER_KEY: 'sk-abc123456', PIN: '12' });
    expect(redact('key=sk-abc123456 and sk-abc123456')).toBe(
      'key=[REDACTED:OPENROUTER_KEY] and [REDACTED:OPENROUTER_KEY]',
    );
    expect(redact('pin 12')).toBe('pin 12');
  });
});

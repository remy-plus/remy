// OAuth sign-in for remote servers: the redirect listener, token storage, the provider, and a full
// sign-in against a fake OAuth-protected MCP server over real HTTP. No real browser, no real service.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpConnection } from '@remy/mcp';
import { type FakeOAuthServer, fakeOAuthServer } from '@remy/mcp/oauth-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetOAuth,
  hasOAuthTokens,
  openInBrowser,
  openOAuthStore,
  RemyOAuthProvider,
  signIn,
  startRedirectListener,
} from './mcp-oauth.ts';
import { openSecretStore, type SecretStore } from './mcp-secrets.ts';

let home: string;
let secrets: SecretStore;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-oauth-'));
  secrets = openSecretStore({ home, platform: 'linux' });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const get = (url: string, host?: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: host ? { host } : {},
        agent: false,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });

describe('redirect listener', () => {
  it('binds 127.0.0.1 on a random port and takes the code once', async () => {
    const l = await startRedirectListener();
    expect(l.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const ok = await get(`${l.redirectUrl}?code=abc&state=${l.state}`);
    expect(ok.status).toBe(200);
    expect(await l.code).toBe('abc');
    // Used up: the port is closed now.
    await expect(get(`${l.redirectUrl}?code=again&state=${l.state}`)).rejects.toThrow();
    await l.close();
  });

  it('two listeners get different ports and states', async () => {
    const a = await startRedirectListener();
    const b = await startRedirectListener();
    expect(a.redirectUrl).not.toBe(b.redirectUrl);
    expect(a.state).not.toBe(b.state);
    await Promise.all([a.close(), b.close()]);
  });

  it('refuses a wrong state without being used up', async () => {
    const l = await startRedirectListener();
    const bad = await get(`${l.redirectUrl}?code=evil&state=nope`);
    expect(bad.status).toBe(400);
    const missing = await get(`${l.redirectUrl}?code=evil`);
    expect(missing.status).toBe(400);
    await get(`${l.redirectUrl}?code=good&state=${l.state}`);
    expect(await l.code).toBe('good');
    await l.close();
  });

  it('refuses another Host name and other paths', async () => {
    const l = await startRedirectListener();
    const port = new URL(l.redirectUrl).port;
    const rebind = await get(`${l.redirectUrl}?code=x&state=${l.state}`, `evil.example:${port}`);
    expect(rebind.status).toBe(400);
    const other = await get(`http://127.0.0.1:${port}/other?code=x&state=${l.state}`);
    expect(other.status).toBe(404);
    await l.close();
  });

  it('turns a refusal in the browser into a clear error', async () => {
    const l = await startRedirectListener();
    await get(`${l.redirectUrl}?error=access_denied&state=${l.state}`);
    await expect(l.code).rejects.toMatchObject({
      kind: 'denied',
      message: 'Access was not granted in the browser.',
    });
  });

  it('ignores an error that carries the wrong state', async () => {
    const l = await startRedirectListener();
    const r = await get(`${l.redirectUrl}?error=access_denied&state=nope`);
    expect(r.status).toBe(400);
    await get(`${l.redirectUrl}?code=ok&state=${l.state}`);
    expect(await l.code).toBe('ok');
  });

  it('times out with a clear message and closes', async () => {
    const l = await startRedirectListener({ timeoutMs: 30 });
    await expect(l.code).rejects.toMatchObject({ kind: 'timeout' });
    await expect(get(`${l.redirectUrl}?code=x&state=${l.state}`)).rejects.toThrow();
  });

  it('closes when cancelled', async () => {
    const ac = new AbortController();
    const l = await startRedirectListener({ signal: ac.signal });
    ac.abort();
    await expect(l.code).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('does not reflect anything from the request into its page', async () => {
    const l = await startRedirectListener();
    const r = await get(`${l.redirectUrl}?code=<script>x</script>&state=bad`);
    expect(r.body).not.toContain('<script>x');
    await l.close();
  });
});

describe('token storage', () => {
  it('keeps tokens and client under mcp:<server>.oauth and deletes them', () => {
    const store = openOAuthStore(secrets, 'notion');
    expect(store.load()).toEqual({});
    store.save({ tokens: { access_token: 'AT', token_type: 'Bearer', refresh_token: 'RT' } });
    expect(secrets.list().map((s) => s.name)).toEqual(['notion.oauth']);
    expect(hasOAuthTokens(secrets, 'notion')).toBe(true);
    expect(openOAuthStore(secrets, 'notion').load().tokens?.refresh_token).toBe('RT');
    expect(forgetOAuth(secrets, 'notion')).toBe(true);
    expect(secrets.list()).toEqual([]);
    expect(hasOAuthTokens(secrets, 'notion')).toBe(false);
  });

  it('survives a damaged secret by treating it as signed out', () => {
    secrets.set('notion.oauth', 'bm90IGpzb24');
    expect(openOAuthStore(secrets, 'notion').load()).toEqual({});
  });
});

describe('provider', () => {
  const make = (extra: Partial<ConstructorParameters<typeof RemyOAuthProvider>[0]> = {}) =>
    new RemyOAuthProvider({ server: 'notion', store: openOAuthStore(secrets, 'notion'), ...extra });

  it('uses the listener redirect and state, and registers as a public client', () => {
    const p = make({ redirectUrl: 'http://127.0.0.1:5555/callback', state: 'S1' });
    expect(p.redirectUrl).toBe('http://127.0.0.1:5555/callback');
    expect(p.state()).toBe('S1');
    expect(p.clientMetadata).toMatchObject({
      client_name: 'Remy',
      redirect_uris: ['http://127.0.0.1:5555/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('makes a fresh random state when none is given', () => {
    expect(make().state()).not.toBe(make().state());
  });

  it('registers again when the saved client was made for another port', () => {
    const store = openOAuthStore(secrets, 'notion');
    store.save({
      client: { client_id: 'c', redirect_uris: ['http://127.0.0.1:1111/callback'] },
    });
    expect(
      make({ redirectUrl: 'http://127.0.0.1:2222/callback' }).clientInformation(),
    ).toBeUndefined();
    expect(
      make({ redirectUrl: 'http://127.0.0.1:1111/callback' }).clientInformation(),
    ).toMatchObject({
      client_id: 'c',
    });
    // Without a sign-in running, the saved client is used as it is.
    expect(make().clientInformation()).toMatchObject({ client_id: 'c' });
  });

  it('flags needs-sign-in instead of redirecting when no sign-in is running', () => {
    const p = make();
    p.redirectToAuthorization(new URL('https://auth.example/authorize'));
    expect(p.needsSignIn).toBe(true);
  });

  it('keeps the PKCE verifier in memory only', () => {
    const p = make();
    p.saveCodeVerifier('verifier-123');
    expect(p.codeVerifier()).toBe('verifier-123');
    expect(JSON.stringify(openOAuthStore(secrets, 'notion').load())).not.toContain('verifier-123');
  });

  it('invalidates by scope', () => {
    const store = openOAuthStore(secrets, 'notion');
    const all = { tokens: { access_token: 'a', token_type: 'Bearer' }, client: { client_id: 'c' } };
    store.save(all);
    make().invalidateCredentials('tokens');
    expect(store.load()).toEqual({ client: { client_id: 'c' } });
    store.save(all);
    make().invalidateCredentials('client');
    expect(store.load().client).toBeUndefined();
    expect(store.load().tokens).toBeDefined();
    make().invalidateCredentials('all');
    expect(store.load()).toEqual({});
  });

  it('tells the redactor about stored and new tokens', () => {
    openOAuthStore(secrets, 'notion').save({
      tokens: { access_token: 'ACCESS-1', token_type: 'Bearer', refresh_token: 'REFRESH-1' },
    });
    const seen: string[] = [];
    const p = make({ onToken: (kind, v) => seen.push(`${kind}:${v}`) });
    p.saveTokens({ access_token: 'ACCESS-2', token_type: 'Bearer' });
    expect(seen).toEqual(['access:ACCESS-1', 'refresh:REFRESH-1', 'access:ACCESS-2']);
  });
});

describe('the browser', () => {
  it('opens only web addresses, with the right program', async () => {
    const calls: string[][] = [];
    const run = ((cmd: string, args: string[], _o: unknown, cb: (e: Error | null) => void) => {
      calls.push([cmd, ...args]);
      cb(null);
    }) as never;
    expect(await openInBrowser('https://a.example/x?y=1', 'darwin', run)).toBe(true);
    expect(await openInBrowser('http://127.0.0.1:1/', 'linux', run)).toBe(true);
    expect(calls[0]).toEqual(['open', 'https://a.example/x?y=1']);
    expect(calls[1]?.[0]).toBe('xdg-open');
    expect(await openInBrowser('file:///etc/passwd', 'darwin', run)).toBe(false);
    expect(await openInBrowser('javascript:alert(1)', 'darwin', run)).toBe(false);
    expect(await openInBrowser('not a url', 'darwin', run)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('is false when the program fails', async () => {
    const run = ((_c: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) =>
      cb(new Error('no'))) as never;
    expect(await openInBrowser('https://a.example/', 'darwin', run)).toBe(false);
  });
});

describe('signing in end to end', () => {
  let server: FakeOAuthServer;
  beforeEach(async () => {
    server = await fakeOAuthServer();
  });
  afterEach(() => server.close());

  /** A browser that follows the sign-in link and the redirect back to Remy. */
  const browser =
    (seen: string[] = []) =>
    async (url: string) => {
      seen.push(url);
      const res = await fetch(url, { redirect: 'manual' });
      const back = res.headers.get('location');
      if (back) await fetch(back).catch(() => {});
      return true;
    };

  it('registers, signs in with PKCE, stores the tokens and then connects', async () => {
    const seen: string[] = [];
    const tokensSeen: string[] = [];
    const r = await signIn(
      'notion',
      server.url,
      {
        secrets,
        openUrl: browser(seen),
        addSecret: (n, v) => tokensSeen.push(`${n}=${v}`),
      },
      {},
    );
    expect(r).toEqual({ ok: true, already: false });
    expect(server.registrations).toBe(1);
    const auth = server.authorizeRequests[0];
    expect(auth).toMatchObject({ code_challenge_method: 'S256', response_type: 'code' });
    expect(auth?.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(auth?.state?.length).toBeGreaterThan(20);
    expect(seen).toHaveLength(1);
    expect(hasOAuthTokens(secrets, 'notion')).toBe(true);
    expect(tokensSeen.some((t) => t.startsWith('mcp:notion.oauth.access='))).toBe(true);

    // The saved sign-in is enough to connect, with no browser.
    const provider = new RemyOAuthProvider({
      server: 'notion',
      store: openOAuthStore(secrets, 'notion'),
    });
    const conn = new McpConnection(
      'notion',
      { url: server.url, auth: 'oauth' },
      { authProvider: provider },
    );
    expect((await conn.listTools()).map((t) => t.name)).toEqual(['ping']);
    await conn.close();
    expect(provider.needsSignIn).toBe(false);
  });

  it('refreshes quietly when the access token expires', async () => {
    await signIn('notion', server.url, { secrets, openUrl: browser() });
    server.expireAccessTokens();
    const provider = new RemyOAuthProvider({
      server: 'notion',
      store: openOAuthStore(secrets, 'notion'),
    });
    const conn = new McpConnection(
      'notion',
      { url: server.url, auth: 'oauth' },
      { authProvider: provider },
    );
    expect((await conn.listTools()).length).toBe(1);
    expect(server.tokenRequests.map((t) => t.grant)).toContain('refresh_token');
    await conn.close();
  });

  it('a wrong state from the redirect is refused and the sign-in times out', async () => {
    server.forceState = 'attacker';
    const r = await signIn('notion', server.url, { secrets, openUrl: browser(), timeoutMs: 400 });
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    expect(hasOAuthTokens(secrets, 'notion')).toBe(false);
  });

  it('times out when the browser never comes back, naming the time', async () => {
    const r = await signIn('notion', server.url, {
      secrets,
      openUrl: async () => true,
      timeoutMs: 100,
    });
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    expect(r.ok === false && r.message).toMatch(/not finished within/);
  });

  it('gives the link instead of opening the browser with noBrowser, or when opening fails', async () => {
    let opened = 0;
    const urls: { url: string; opened: boolean }[] = [];
    const ac = new AbortController();
    const hook = (url: string, o: boolean) => {
      urls.push({ url, opened: o });
      ac.abort();
    };
    const r1 = await signIn(
      'a',
      server.url,
      {
        secrets,
        openUrl: async () => {
          opened++;
          return true;
        },
      },
      { noBrowser: true, onUrl: hook, signal: ac.signal },
    );
    expect(r1).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(opened).toBe(0);
    expect(urls[0]).toMatchObject({ opened: false });
    expect(urls[0]?.url).toContain('/authorize');

    const ac2 = new AbortController();
    const urls2: boolean[] = [];
    await signIn(
      'b',
      server.url,
      { secrets, openUrl: async () => false },
      {
        signal: ac2.signal,
        onUrl: (_u, o) => {
          urls2.push(o);
          ac2.abort();
        },
      },
    );
    expect(urls2).toEqual([false]);
  });

  it('Esc (abort) cancels and leaves no listener behind', async () => {
    const ac = new AbortController();
    const r = await signIn(
      'notion',
      server.url,
      { secrets, openUrl: async () => true },
      { signal: ac.signal, onUrl: () => ac.abort() },
    );
    expect(r).toMatchObject({ ok: false, reason: 'cancelled', message: 'Sign-in was cancelled.' });
  });

  it('reports a server that is not there in a sentence', async () => {
    const r = await signIn('x', 'http://127.0.0.1:1/mcp', { secrets, openUrl: async () => true });
    expect(r).toMatchObject({ ok: false, reason: 'error' });
    expect(r.ok === false && r.message).toMatch(/^Could not sign in:/);
  });

  it('keeps tokens out of the plain files REMY_HOME holds when the Keychain is used', () => {
    // With the file fallback they sit in mcp-secrets.json at 0600; with the Keychain they do not.
    const kc = openSecretStore({
      home,
      platform: 'darwin',
      exec: (cmd, args) =>
        cmd === 'security' && args[0] === 'add-generic-password'
          ? { status: 0, stdout: '' }
          : { status: 1, stdout: '' },
    });
    openOAuthStore(kc, 'notion').save({
      tokens: { access_token: 'SECRET-TOKEN', token_type: 'Bearer' },
    });
    expect(readFileSync(join(home, 'mcp-secrets.json'), 'utf8')).not.toContain('SECRET-TOKEN');
  });
});

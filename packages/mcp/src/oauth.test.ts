import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpAuthRequiredError, McpConnection } from './connection.ts';
import { McpManager } from './manager.ts';
import {
  authorizeWithProvider,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthTokens,
} from './oauth.ts';
import { type FakeOAuthServer, fakeOAuthServer } from './testing/oauth-server.ts';

/** A provider that keeps everything in memory and "opens the browser" by asking the fake server. */
function memoryProvider(onRedirect: (url: URL) => void = () => {}) {
  let tokens: OAuthTokens | undefined;
  let client: OAuthClientInformationMixed | undefined;
  let verifier = '';
  const p: OAuthClientProvider & { tokensNow: () => OAuthTokens | undefined } = {
    redirectUrl: 'http://127.0.0.1:1/callback',
    clientMetadata: {
      client_name: 'Remy test',
      redirect_uris: ['http://127.0.0.1:1/callback'],
      token_endpoint_auth_method: 'none',
    },
    state: () => 'state-1',
    clientInformation: () => client,
    saveClientInformation: (c) => {
      client = c;
    },
    tokens: () => tokens,
    saveTokens: (t) => {
      tokens = t;
    },
    redirectToAuthorization: (url) => onRedirect(url),
    saveCodeVerifier: (v) => {
      verifier = v;
    },
    codeVerifier: () => verifier,
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'tokens') tokens = undefined;
      if (scope === 'all' || scope === 'client') client = undefined;
    },
    tokensNow: () => tokens,
  };
  return p;
}

/** Follows the authorize URL the way a browser would and returns the code from the redirect. */
async function browse(url: URL): Promise<{ code: string; state: string | null }> {
  const res = await fetch(url, { redirect: 'manual' });
  const back = new URL(res.headers.get('location') ?? '');
  return { code: back.searchParams.get('code') ?? '', state: back.searchParams.get('state') };
}

let server: FakeOAuthServer;
beforeEach(async () => {
  server = await fakeOAuthServer();
});
afterEach(async () => {
  await server.close();
});

const cfg = () => ({ url: server.url, auth: 'oauth' as const });

async function signedIn() {
  let seen: URL | undefined;
  const provider = memoryProvider((u) => {
    seen = u;
  });
  await authorizeWithProvider({
    serverUrl: server.url,
    provider,
    waitForCode: async () => (await browse(seen as URL)).code,
  });
  return provider;
}

describe('OAuth for remote servers', () => {
  it('reports "needs sign-in" instead of a generic failure', async () => {
    const conn = new McpConnection('notion', cfg(), { authProvider: memoryProvider() });
    await expect(conn.listTools()).rejects.toBeInstanceOf(McpAuthRequiredError);
    await conn.close();
  });

  it('maps the same way with no provider at all (a bare 401)', async () => {
    const conn = new McpConnection('plain', { url: server.url });
    await expect(conn.listTools()).rejects.toBeInstanceOf(McpAuthRequiredError);
    const out = await conn.callTool(
      'ping',
      {},
      { signal: new AbortController().signal, timeoutMs: 2000 },
    );
    expect(out).toMatchObject({ ok: false, phase: 'before_effect', retryable: false });
    expect(out.ok === false && out.error).toContain('remy connect auth plain');
    await conn.close();
  });

  it('the manager flags the server so the app can show "needs sign-in"', async () => {
    const m = new McpManager({ notion: cfg() }, () => ({ authProvider: memoryProvider() }));
    const r = await m.loadTools();
    expect(r.errors).toEqual([expect.objectContaining({ server: 'notion', needsAuth: true })]);
    await m.closeAll();
  });

  it('signs in with registration and PKCE, then lists tools with the token', async () => {
    let seen: URL | undefined;
    const provider = memoryProvider((u) => {
      seen = u;
    });
    const how = await authorizeWithProvider({
      serverUrl: server.url,
      provider,
      waitForCode: async () => {
        const got = await browse(seen as URL);
        expect(got.state).toBe('state-1');
        return got.code;
      },
    });
    expect(how).toBe('signed_in');
    expect(server.registrations).toBe(1);
    expect(server.authorizeRequests[0]).toMatchObject({
      code_challenge_method: 'S256',
      state: 'state-1',
      response_type: 'code',
    });
    const conn = new McpConnection('notion', cfg(), { authProvider: provider });
    expect((await conn.listTools()).map((t) => t.name)).toEqual(['ping']);
    await conn.close();
  });

  it('refreshes an expired access token on its own', async () => {
    const provider = await signedIn();
    const before = provider.tokensNow()?.access_token;
    server.expireAccessTokens();
    const conn = new McpConnection('notion', cfg(), { authProvider: provider });
    expect((await conn.listTools()).length).toBe(1);
    expect(server.tokenRequests.map((t) => t.grant)).toContain('refresh_token');
    expect(provider.tokensNow()?.access_token).not.toBe(before);
    await conn.close();
  });

  it('asks to sign in again when the refresh token is gone', async () => {
    const provider = await signedIn();
    server.revokeEverything();
    const conn = new McpConnection('notion', cfg(), { authProvider: provider });
    await expect(conn.listTools()).rejects.toBeInstanceOf(McpAuthRequiredError);
    await conn.close();
  });
});

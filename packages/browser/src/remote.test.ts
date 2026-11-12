import { describe, expect, it } from 'vitest';
import {
  createBrowserbaseProvider,
  createSteelProvider,
  type FetchLike,
  redactSecrets,
  remoteNotice,
} from './remote.ts';

function fake(reply: (url: string) => { ok: boolean; status: number; body?: unknown }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
    [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const r = reply(url);
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  return { fetch, calls };
}

describe('Steel', () => {
  it('creates a session with the key in a header and releases it', async () => {
    const f = fake((u) =>
      u.endsWith('/release')
        ? { ok: true, status: 200, body: {} }
        : {
            ok: true,
            status: 200,
            body: { id: 's 1', sessionViewerUrl: 'https://app.steel.dev/v/1' },
          },
    );
    const s = await createSteelProvider({ apiKey: 'sk/secret', fetch: f.fetch }).createSession();
    expect(f.calls[0]).toMatchObject({ url: 'https://api.steel.dev/v1/sessions', method: 'POST' });
    expect(f.calls[0]?.headers['steel-api-key']).toBe('sk/secret');
    expect(s.cdpUrl).toBe('wss://connect.steel.dev?apiKey=sk%2Fsecret&sessionId=s%201');
    expect(s.viewerUrl).toBe('https://app.steel.dev/v/1');
    await s.close();
    expect(f.calls[1]?.url).toBe('https://api.steel.dev/v1/sessions/s%201/release');
  });

  it('fails in plain words without the key, and close never throws', async () => {
    const f = fake(() => ({ ok: false, status: 401 }));
    const p = createSteelProvider({ apiKey: 'sk-secret-1', fetch: f.fetch });
    const err = await p.createSession().catch((e: Error) => e);
    expect((err as Error).message).toContain('key was not accepted');
    expect((err as Error).message).not.toContain('sk-secret-1');
    const boom = createSteelProvider({
      apiKey: 'sk-secret-1',
      fetch: async () => {
        throw new Error('connect to sk-secret-1 failed');
      },
    });
    const e2 = (await boom.createSession().catch((e: Error) => e)) as Error;
    expect(e2.message).not.toContain('sk-secret-1');
    expect(e2.message).toContain('REMY_BROWSER');
  });
});

describe('Browserbase', () => {
  it('creates with the project id and releases with REQUEST_RELEASE', async () => {
    const f = fake((u) =>
      u.endsWith('/v1/sessions')
        ? {
            ok: true,
            status: 201,
            body: { id: 'b1', connectUrl: 'wss://connect.browserbase.com?signingKey=zz' },
          }
        : { ok: true, status: 200, body: {} },
    );
    const s = await createBrowserbaseProvider({
      apiKey: 'bb-key',
      projectId: 'proj',
      fetch: f.fetch,
    }).createSession();
    expect(f.calls[0]?.headers['X-BB-API-Key']).toBe('bb-key');
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ projectId: 'proj' });
    expect(s.cdpUrl).toContain('signingKey=zz');
    await s.close();
    expect(f.calls[1]?.url).toBe('https://api.browserbase.com/v1/sessions/b1');
    expect(JSON.parse(f.calls[1]?.body ?? '{}')).toMatchObject({ status: 'REQUEST_RELEASE' });
  });

  it('rejects a response with no connect address', async () => {
    const f = fake(() => ({ ok: true, status: 201, body: { id: 'b1' } }));
    await expect(
      createBrowserbaseProvider({
        apiKey: 'k1234',
        projectId: 'p',
        fetch: f.fetch,
      }).createSession(),
    ).rejects.toThrow(/did not start a browser session/);
  });
});

describe('redaction', () => {
  it('hides a secret and its encoded form', () => {
    expect(redactSecrets('x sk/secret y sk%2Fsecret', ['sk/secret'])).toBe('x [hidden] y [hidden]');
  });
  it('names the cloud', () => {
    expect(remoteNotice('Steel')).toBe(
      "Pages open in Steel's cloud browser, not on this computer.",
    );
  });
});

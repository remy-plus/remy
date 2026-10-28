// Signing in to remote servers (Notion, Linear, ...) with OAuth.
//
// The MCP SDK runs the protocol: discovery, dynamic client registration, PKCE, token refresh. This
// file is what the SDK asks the app for: where tokens and the registered client live (the secret
// store, account `mcp:<server>.oauth`: the Keychain, else a private file), a one-shot redirect
// listener on 127.0.0.1, and the browser. Tokens and the client id are never logged, never in
// events or notes; each token is registered with the redactor as it arrives.
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  authorizeWithProvider,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@remy/mcp';
import type { SignInHooks } from './connections-view.ts';
import type { SecretStore } from './mcp-secrets.ts';

/** How long a sign-in may take before Remy stops waiting. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** Each request to the service's sign-in endpoints. */
const REQUEST_TIMEOUT_MS = 30_000;

export const oauthSecretName = (server: string) => `${server}.oauth`;

interface Saved {
  tokens?: OAuthTokens;
  client?: OAuthClientInformationMixed;
}

/** The tokens and registered client of one server, in one secret. */
export interface OAuthStore {
  load(): Saved;
  save(next: Saved): void;
  clear(): void;
}

export function openOAuthStore(secrets: SecretStore, server: string): OAuthStore {
  const name = oauthSecretName(server);
  return {
    load() {
      const raw = secrets.get(name);
      if (!raw) return {};
      try {
        const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Saved;
        return v && typeof v === 'object' ? v : {};
      } catch {
        return {};
      }
    },
    save(next) {
      if (!next.tokens && !next.client) {
        secrets.remove(name);
        return;
      }
      // base64url keeps the value to characters the Keychain command line takes as they are.
      secrets.set(name, Buffer.from(JSON.stringify(next), 'utf8').toString('base64url'));
    },
    clear() {
      secrets.remove(name);
    },
  };
}

/** True when sign-in has produced tokens for this server. */
export const hasOAuthTokens = (secrets: SecretStore, server: string): boolean =>
  Boolean(openOAuthStore(secrets, server).load().tokens);

/** Forgets the sign-in of a server (tokens and registered client). */
export const forgetOAuth = (secrets: SecretStore, server: string): boolean =>
  secrets.remove(oauthSecretName(server));

// ---------------------------------------------------------------------------------------------
// The redirect listener

export type SignInFailure = 'timeout' | 'cancelled' | 'denied';

export class SignInError extends Error {
  readonly kind: SignInFailure;
  constructor(kind: SignInFailure, message: string) {
    super(message);
    this.name = 'SignInError';
    this.kind = kind;
  }
}

export interface RedirectListener {
  /** `http://127.0.0.1:<port>/callback`. */
  redirectUrl: string;
  /** The `state` the redirect must carry back. */
  state: string;
  /** The authorization code. Rejects with a SignInError on timeout, cancel or a refusal. */
  code: Promise<string>;
  close(): Promise<void>;
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>Remy</title><body style="font:16px ui-monospace,Menlo,monospace;background:#EDEBE6;color:#0F0F10;padding:4rem"><h1 style="font-size:1.1rem">${title}</h1><p style="color:#8C8A85">${line}</p>`;

const sameCode = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Listens for the browser's redirect on 127.0.0.1 only, on a random port. It answers one valid
 * callback and then closes. A callback with the wrong `state` (or another Host name, which is how
 * DNS rebinding shows up) is refused and does not use the listener up.
 */
export async function startRedirectListener(
  o: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RedirectListener> {
  const state = randomBytes(24).toString('base64url');
  let settle: { ok: (code: string) => void; fail: (e: Error) => void } | undefined;
  const code = new Promise<string>((ok, fail) => {
    settle = { ok, fail };
  });
  code.catch(() => {}); // the caller awaits it; closing early must not become an unhandled rejection
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let port = 0;

  const server = createServer((req, res) => {
    const reply = (status: number, title: string, line: string) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      });
      res.end(PAGE(title, line));
    };
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return reply(400, 'Not from Remy', 'This address only answers the sign-in redirect.');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method !== 'GET' || url.pathname !== '/callback')
      return reply(404, 'Nothing here', 'This address only answers the sign-in redirect.');
    if (done) return reply(410, 'Already used', 'Return to Remy.');
    const got = url.searchParams.get('state');
    if (got === null || !sameCode(got, state))
      return reply(400, 'Not from this sign-in', 'Start again from Remy.');
    const err = url.searchParams.get('error');
    const authCode = url.searchParams.get('code');
    if (err) {
      done = true;
      reply(200, 'Sign-in was not completed', 'You can close this tab and return to Remy.');
      const kind = err.replace(/[^a-z_]/g, '').slice(0, 60) || 'error';
      settle?.fail(
        new SignInError(
          'denied',
          kind === 'access_denied'
            ? 'Access was not granted in the browser.'
            : `The service ended the sign-in (${kind}).`,
        ),
      );
    } else if (authCode) {
      done = true;
      reply(200, 'Signed in to Remy', 'You can close this tab and return to Remy.');
      settle?.ok(authCode);
    } else return reply(400, 'Nothing to use', 'Start again from Remy.');
    void close();
  });

  const close = async () => {
    clearTimeout(timer);
    done = true;
    o.signal?.removeEventListener('abort', onAbort);
    if (!server.listening) return;
    await new Promise<void>((r) => {
      server.close(() => r());
      // The page that was just sent is the only open connection; do not wait for keep-alive.
      server.closeAllConnections();
    });
  };
  const onAbort = () => {
    settle?.fail(new SignInError('cancelled', 'Sign-in was cancelled.'));
    void close();
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
  const ms = o.timeoutMs ?? SIGN_IN_TIMEOUT_MS;
  timer = setTimeout(() => {
    settle?.fail(
      new SignInError(
        'timeout',
        `Sign-in was not finished within ${ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`}.`,
      ),
    );
    void close();
  }, ms);
  timer.unref();
  if (o.signal?.aborted) onAbort();
  else o.signal?.addEventListener('abort', onAbort, { once: true });
  return { redirectUrl: `http://127.0.0.1:${port}/callback`, state, code, close };
}

// ---------------------------------------------------------------------------------------------
// The provider

export interface ProviderOptions {
  server: string;
  store: OAuthStore;
  /** Set while a sign-in is running: where the browser comes back to. Without it the provider only refreshes. */
  redirectUrl?: string;
  state?: string;
  /** Set while a sign-in is running: where to send the user. */
  onAuthorizeUrl?: (url: URL) => void;
  /** A token the redactor must know about. */
  onToken?: (kind: 'access' | 'refresh', value: string) => void;
}

const FALLBACK_REDIRECT = 'http://127.0.0.1/callback';

/**
 * What the SDK needs from the app. Without a running sign-in (no `onAuthorizeUrl`) it can still use
 * and refresh stored tokens, and `needsSignIn` turns true when the server wants a browser step.
 */
export class RemyOAuthProvider implements OAuthClientProvider {
  needsSignIn = false;
  readonly #o: ProviderOptions;
  #verifier = '';

  constructor(o: ProviderOptions) {
    this.#o = o;
    const t = o.store.load().tokens;
    if (t) this.#announce(t);
  }

  #announce(t: OAuthTokens) {
    this.#o.onToken?.('access', t.access_token);
    if (t.refresh_token) this.#o.onToken?.('refresh', t.refresh_token);
  }

  get redirectUrl(): string {
    const first = (this.#o.store.load().client as { redirect_uris?: string[] } | undefined)
      ?.redirect_uris?.[0];
    return this.#o.redirectUrl ?? (first ? String(first) : FALLBACK_REDIRECT);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Remy',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.#o.state ?? randomBytes(24).toString('base64url');
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const c = this.#o.store.load().client;
    // A registration made for another port cannot receive this sign-in's redirect: register again.
    if (c && this.#o.redirectUrl) {
      const uris = (c as { redirect_uris?: string[] }).redirect_uris ?? [];
      if (!uris.includes(this.#o.redirectUrl)) return undefined;
    }
    return c;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.#o.store.save({ ...this.#o.store.load(), client });
  }

  tokens(): OAuthTokens | undefined {
    return this.#o.store.load().tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.#announce(tokens);
    this.#o.store.save({ ...this.#o.store.load(), tokens });
  }

  redirectToAuthorization(url: URL): void {
    if (this.#o.onAuthorizeUrl) this.#o.onAuthorizeUrl(url);
    else this.needsSignIn = true;
  }

  saveCodeVerifier(verifier: string): void {
    this.#verifier = verifier;
  }

  codeVerifier(): string {
    return this.#verifier;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'verifier') this.#verifier = '';
    if (scope === 'all') {
      this.#o.store.clear();
      return;
    }
    const { tokens, client } = this.#o.store.load();
    if (scope === 'tokens') this.#o.store.save({ ...(client && { client }) });
    if (scope === 'client') this.#o.store.save({ ...(tokens && { tokens }) });
  }
}

// ---------------------------------------------------------------------------------------------
// The browser

/** Opens a page in the default browser; false when it could not. Only web addresses. */
export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  run: typeof execFile = execFile,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return Promise.resolve(false);
  const [cmd, args]: [string, string[]] =
    platform === 'darwin'
      ? ['open', [parsed.href]]
      : platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', parsed.href]]
        : ['xdg-open', [parsed.href]];
  return new Promise((resolve) => {
    try {
      run(cmd, args, { timeout: 10_000 }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Signing in

export interface SignInDeps {
  secrets: SecretStore;
  /** Opens the browser. Default: the system's. */
  openUrl?: (url: string) => Promise<boolean>;
  /** Registers a token with the redactor. */
  addSecret?: (name: string, value: string) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type SignInResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: SignInFailure | 'error'; message: string };

/** A fetch for the service's sign-in endpoints that gives up on a hung request and on cancel. */
function boundedFetch(base: typeof fetch, signal: AbortSignal | undefined): typeof fetch {
  return (input, init) =>
    base(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(init?.signal ? [init.signal] : []),
        ...(signal ? [signal] : []),
      ]),
    });
}

/**
 * Runs the whole browser sign-in for one remote server and stores the tokens. Never throws; a
 * failure comes back with a sentence the user can act on. With `force`, the old sign-in is dropped
 * first (a still-working one would otherwise be kept).
 */
export async function signIn(
  server: string,
  url: string,
  deps: SignInDeps,
  hooks: SignInHooks = {},
  force = false,
): Promise<SignInResult> {
  const store = openOAuthStore(deps.secrets, server);
  if (force) store.clear();
  let listener: RedirectListener | undefined;
  try {
    listener = await startRedirectListener({
      ...(deps.timeoutMs !== undefined && { timeoutMs: deps.timeoutMs }),
      ...(hooks.signal && { signal: hooks.signal }),
    });
    const open = deps.openUrl ?? openInBrowser;
    const provider = new RemyOAuthProvider({
      server,
      store,
      redirectUrl: listener.redirectUrl,
      state: listener.state,
      ...(deps.addSecret && {
        onToken: (kind, v) => deps.addSecret?.(`mcp:${server}.oauth.${kind}`, v),
      }),
      onAuthorizeUrl: (u) => {
        const href = u.href;
        void (async () => {
          const opened = hooks.noBrowser ? false : await open(href);
          hooks.onUrl?.(href, opened);
        })();
      },
    });
    const how = await authorizeWithProvider({
      serverUrl: url,
      provider,
      waitForCode: () => (listener as RedirectListener).code,
      fetchFn: boundedFetch(deps.fetch ?? fetch, hooks.signal),
    });
    return { ok: true, already: how === 'already' };
  } catch (e) {
    if (e instanceof SignInError) return { ok: false, reason: e.kind, message: e.message };
    if (hooks.signal?.aborted)
      return { ok: false, reason: 'cancelled', message: 'Sign-in was cancelled.' };
    return { ok: false, reason: 'error', message: `Could not sign in: ${oneLine(e)}` };
  } finally {
    await listener?.close();
  }
}

const oneLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).trim().split('\n')[0]?.slice(0, 160) ??
  'unknown error';

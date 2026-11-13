/**
 * Cloud browsers (Steel, Browserbase) Remy can drive instead of the local hidden Chrome. Opt-in:
 * the person sets REMY_BROWSER. A provider only starts and releases a session; the page driver
 * connects to its CDP address. The address and the API key are secrets: they are redacted from
 * every message that leaves this file.
 */

export interface RemoteSession {
  /** Where the driver connects. Contains a secret: never log it. */
  cdpUrl: string;
  sessionId: string;
  /** A link the person can open to watch the session, when the service offers one. */
  viewerUrl?: string;
  /** Releases the session. Never throws. */
  close(): Promise<void>;
}

export interface RemoteSessionProvider {
  /** `steel` or `browserbase`. */
  id: string;
  /** Display name, e.g. "Steel". */
  label: string;
  /** What the status line says. Default: the cloud-browser sentence. */
  notice?: string;
  /** Why there is no window to show. Default: the cloud-browser sentence. */
  noWindow?: string;
  createSession(): Promise<RemoteSession>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RemoteOptions {
  fetch?: FetchLike;
}

/** Replaces every secret (and its URL-encoded form) in `text`. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    for (const form of new Set([s, encodeURIComponent(s)])) out = out.split(form).join('[hidden]');
  }
  return out;
}

/** The sentence shown wherever the browser's status is. */
export function remoteNotice(label: string): string {
  return `Pages open in ${label}'s cloud browser, not on this computer.`;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

function fail(label: string, what: string, status?: number): Error {
  const why =
    status === 401 || status === 403
      ? 'the key was not accepted'
      : status === 402 || status === 429
        ? 'the plan or rate limit is used up'
        : status
          ? `it answered ${status}`
          : 'it could not be reached';
  return new Error(
    `${label} did not ${what}: ${why}. Remy does not switch to the browser on this computer by itself. Fix it, or unset REMY_BROWSER.`,
  );
}

async function call(
  label: string,
  doFetch: FetchLike,
  what: string,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(url, init);
  } catch {
    throw fail(label, what); // the error text could carry the key; say nothing of it
  }
  if (!res.ok) throw fail(label, what, res.status);
  return res.json().catch(() => {
    throw fail(label, what);
  });
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function createSteelProvider(
  opts: { apiKey: string } & RemoteOptions,
): RemoteSessionProvider {
  const doFetch = opts.fetch ?? defaultFetch;
  const headers = { 'steel-api-key': opts.apiKey, 'content-type': 'application/json' };
  return {
    id: 'steel',
    label: 'Steel',
    async createSession() {
      const body = (await call(
        'Steel',
        doFetch,
        'start a browser session',
        'https://api.steel.dev/v1/sessions',
        { method: 'POST', headers, body: '{}' },
      )) as Record<string, unknown> | null;
      const sessionId = str(body?.id);
      if (!sessionId) throw fail('Steel', 'start a browser session');
      const cdpUrl = `wss://connect.steel.dev?apiKey=${encodeURIComponent(opts.apiKey)}&sessionId=${encodeURIComponent(sessionId)}`;
      const viewerUrl = str(body?.sessionViewerUrl);
      return {
        cdpUrl,
        sessionId,
        ...(viewerUrl && { viewerUrl }),
        async close() {
          await call(
            'Steel',
            doFetch,
            'release the browser session',
            `https://api.steel.dev/v1/sessions/${encodeURIComponent(sessionId)}/release`,
            { method: 'POST', headers, body: '{}' },
          ).catch(() => {});
        },
      };
    },
  };
}

export function createBrowserbaseProvider(
  opts: { apiKey: string; projectId: string } & RemoteOptions,
): RemoteSessionProvider {
  const doFetch = opts.fetch ?? defaultFetch;
  const headers = { 'X-BB-API-Key': opts.apiKey, 'content-type': 'application/json' };
  return {
    id: 'browserbase',
    label: 'Browserbase',
    async createSession() {
      const body = (await call(
        'Browserbase',
        doFetch,
        'start a browser session',
        'https://api.browserbase.com/v1/sessions',
        { method: 'POST', headers, body: JSON.stringify({ projectId: opts.projectId }) },
      )) as Record<string, unknown> | null;
      const sessionId = str(body?.id);
      const cdpUrl = str(body?.connectUrl);
      if (!sessionId || !cdpUrl) throw fail('Browserbase', 'start a browser session');
      return {
        cdpUrl,
        sessionId,
        async close() {
          await call(
            'Browserbase',
            doFetch,
            'release the browser session',
            `https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ projectId: opts.projectId, status: 'REQUEST_RELEASE' }),
            },
          ).catch(() => {});
        },
      };
    },
  };
}

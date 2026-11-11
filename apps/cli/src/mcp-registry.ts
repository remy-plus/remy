// The official MCP Registry, read-only. The curated list in `mcp-catalog.ts` is nine servers that
// were checked by hand; the registry is thousands, so an app that is not on that list can still be
// found. Nothing here is trusted: a record only becomes a connection after the person sees the
// exact command or address and says yes, which is why this never feeds the web route that adds a
// server from a request.
//
// Shape read from https://registry.modelcontextprotocol.io/v0/servers on 2026-11-11.

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const TIMEOUT_MS = 8000;

/** One value a server needs before it will start: an environment variable or a request header. */
export interface RegistrySecret {
  /** The environment variable or header name; also the key the value is stored under. */
  key: string;
  label: string;
  where: string;
  /**
   * For a header: the record's own value with a `{placeholder}` where the secret goes, e.g.
   * `Bearer {token}`. Undefined for an environment variable, which is just the value.
   */
  template?: string;
}

/** A registry record, flattened to what a connection needs. */
export interface RegistryApp {
  /** The registry's own name, e.g. `ac.inference.sh/mcp`. Unique per server. */
  name: string;
  title: string;
  description: string;
  version: string;
  /** `remote` is a hosted address; `package` is a program this machine runs. */
  kind: 'remote' | 'package';
  url?: string;
  command?: string;
  args?: string[];
  /** Values to ask for, in the order the record lists them. */
  secrets: RegistrySecret[];
  /** Where the server's own code lives, when the record says. */
  repository?: string;
}

interface RawHeader {
  name?: unknown;
  value?: unknown;
  description?: unknown;
  isRequired?: unknown;
  isSecret?: unknown;
}

interface RawEnv {
  name?: unknown;
  description?: unknown;
  isRequired?: unknown;
  isSecret?: unknown;
}

interface RawRemote {
  type?: unknown;
  url?: unknown;
  headers?: unknown;
}

interface RawPackage {
  registryType?: unknown;
  identifier?: unknown;
  version?: unknown;
  runtimeHint?: unknown;
  transport?: unknown;
  runtimeArguments?: unknown;
  environmentVariables?: unknown;
}

interface RawServer {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  version?: unknown;
  repository?: unknown;
  remotes?: unknown;
  packages?: unknown;
}

interface RawRecord {
  server?: RawServer;
  _meta?: Record<string, { isLatest?: unknown } | undefined>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The registry lists every published version; only the newest of each name is worth showing. */
const isLatest = (r: RawRecord): boolean => {
  const meta = r._meta?.['io.modelcontextprotocol.registry/official'];
  return meta?.isLatest !== false;
};

/** `{smithery_api_key}` in a header value becomes the secret reference Remy stores. */
export function headerValue(raw: string, server: string, key: string): string {
  const ref = `\${secret:${server}.${key}}`;
  return raw.replace(/\{[^}]*\}/g, ref);
}

/** The first hosted address, or undefined when the record only ships a program. */
function remoteOf(server: RawServer): { url: string; headers: RawHeader[] } | undefined {
  for (const r of arr(server.remotes) as RawRemote[]) {
    const url = str(r.url);
    if (!/^https?:\/\//i.test(url)) continue;
    return { url, headers: arr(r.headers) as RawHeader[] };
  }
  return undefined;
}

/** The first npm package, as the command this machine would run. */
function packageOf(
  server: RawServer,
): { command: string; args: string[]; env: RawEnv[] } | undefined {
  for (const p of arr(server.packages) as RawPackage[]) {
    const id = str(p.identifier);
    if (!id) continue;
    const kind = str(p.registryType);
    if (kind && kind !== 'npm') continue;
    const hint = str(p.runtimeHint) || 'npx';
    const args = arr(p.runtimeArguments)
      .map((a) => str((a as { value?: unknown })?.value))
      .filter(Boolean);
    // `npx` stops to ask before it installs anything, which would hang a server that is started
    // without a terminal. Records that already say `-y` keep their own order.
    const quiet = hint === 'npx' && !args.some((a) => a === '-y' || a === '--yes');
    return {
      command: hint,
      args: [...(quiet ? ['-y'] : []), ...args, id],
      env: arr(p.environmentVariables) as RawEnv[],
    };
  }
  return undefined;
}

const secretOf = (raw: RawEnv | RawHeader, fallback: string, template?: string): RegistrySecret => {
  const key = str(raw.name) || fallback;
  const description = str(raw.description);
  return {
    key,
    label: description || key,
    where: description || `the value ${key} for this server`,
    ...(template !== undefined && { template }),
  };
};

/** One registry record as a connection, or undefined when it offers no way to reach it. */
export function toApp(record: RawRecord): RegistryApp | undefined {
  const server = record.server;
  if (!server) return undefined;
  const name = str(server.name);
  if (!name) return undefined;
  const title = str(server.title) || name;
  const description = str(server.description);
  const version = str(server.version);
  const repo = str((server.repository as { url?: unknown } | undefined)?.url);

  const remote = remoteOf(server);
  if (remote) {
    const secrets = remote.headers
      .filter((h) => str(h.name) && (h.isRequired === true || h.isSecret === true))
      .map((h) => secretOf(h, 'Authorization', str(h.value)));
    return {
      name,
      title,
      description,
      version,
      kind: 'remote',
      url: remote.url,
      secrets,
      ...(repo && { repository: repo }),
    };
  }

  const pkg = packageOf(server);
  if (pkg) {
    const secrets = pkg.env
      .filter((e) => str(e.name) && (e.isRequired === true || e.isSecret === true))
      .map((e) => secretOf(e, 'VALUE'));
    return {
      name,
      title,
      description,
      version,
      kind: 'package',
      command: pkg.command,
      args: pkg.args,
      secrets,
      ...(repo && { repository: repo }),
    };
  }
  return undefined;
}

/** The registry's answer, newest version of each server, in the order it gave them. */
export function toApps(body: unknown): RegistryApp[] {
  const records = arr((body as { servers?: unknown } | undefined)?.servers) as RawRecord[];
  const seen = new Set<string>();
  const out: RegistryApp[] = [];
  for (const r of records) {
    if (!isLatest(r)) continue;
    const app = toApp(r);
    if (!app || seen.has(app.name)) continue;
    seen.add(app.name);
    out.push(app);
  }
  return out;
}

export interface SearchOptions {
  limit?: number;
  /** How the request is made; tests replace it. */
  fetch?(url: string, init: { signal: AbortSignal }): Promise<Response>;
}

/**
 * Searches the registry. A blank query lists what it has, newest first. Throws with a sentence the
 * person can act on when the registry cannot be reached, because a silent empty list would read as
 * "there is no such app".
 */
export async function searchRegistry(
  query: string,
  opts: SearchOptions = {},
): Promise<RegistryApp[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const url = new URL(REGISTRY);
  url.searchParams.set('limit', String(limit));
  const q = query.trim();
  if (q) url.searchParams.set('search', q);
  const doFetch = opts.fetch ?? ((u, init) => fetch(u, init));
  let res: Response;
  try {
    res = await doFetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(
      'The app registry could not be reached. Check this machine is online, then try again.',
    );
  }
  if (!res.ok) throw new Error(`The app registry answered ${res.status}. Try again in a moment.`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('The app registry sent something that is not a list of apps.');
  }
  return toApps(body);
}

import {
  createBrowserbaseProvider,
  createSteelProvider,
  type FetchLike,
  type RemoteSessionProvider,
} from '@remy/browser';

import { type Exec, keychainGet, keychainOff, realExec } from './credentials.ts';
import { type KeySource, readServiceKey, type ServiceKeyOptions } from './service-keys.ts';

/** Reads one key: the environment first, then the Keychain (service `remy`, this account). */
export type KeyReader = (envName: string, account: string) => string | undefined;

const SERVICES = {
  steel: { label: 'Steel', env: 'STEEL_API_KEY' },
  browserbase: { label: 'Browserbase', env: 'BROWSERBASE_API_KEY' },
} as const;

export type RemoteChoice =
  | { kind: 'local' }
  | { kind: 'remote'; provider: RemoteSessionProvider; secrets: string[] }
  | { kind: 'error'; message: string };

/**
 * REMY_BROWSER=steel|browserbase picks a cloud browser; anything else (or nothing) keeps Remy's
 * own browser on this computer. A missing key is an error, never a quiet switch back to local.
 */
export function resolveRemoteBrowser(
  env: Record<string, string | undefined>,
  readKey: KeyReader,
  fetch?: FetchLike,
): RemoteChoice {
  const want = (env.REMY_BROWSER ?? '').trim().toLowerCase();
  if (!want || want === 'local') return { kind: 'local' };
  if (want !== 'steel' && want !== 'browserbase')
    return {
      kind: 'error',
      message: `REMY_BROWSER=${want} is not a browser Remy knows. Use steel, browserbase, or leave it unset.`,
    };
  const svc = SERVICES[want];
  const apiKey = readKey(svc.env, want);
  if (!apiKey)
    return {
      kind: 'error',
      message: `REMY_BROWSER=${want} needs a key. Set ${svc.env} (or save it in the Keychain: security add-generic-password -s remy -a ${want} -w), or unset REMY_BROWSER to use the browser on this computer.`,
    };
  if (want === 'steel')
    return {
      kind: 'remote',
      provider: createSteelProvider({ apiKey, ...(fetch && { fetch }) }),
      secrets: [apiKey],
    };
  const projectId = readKey('BROWSERBASE_PROJECT_ID', 'browserbase-project');
  if (!projectId)
    return {
      kind: 'error',
      message:
        'REMY_BROWSER=browserbase needs a project id. Set BROWSERBASE_PROJECT_ID (or save it in the Keychain: security add-generic-password -s remy -a browserbase-project -w), or unset REMY_BROWSER.',
    };
  return {
    kind: 'remote',
    provider: createBrowserbaseProvider({ apiKey, projectId, ...(fetch && { fetch }) }),
    secrets: [apiKey, projectId],
  };
}

/** A synchronous key reader: the environment first, then (macOS, REMY_KEYCHAIN not off) the Keychain. */
export function makeKeyReader(
  env: Record<string, string | undefined>,
  opts: { platform?: NodeJS.Platform; exec?: Exec } = {},
): KeyReader {
  return (envName, account) => {
    const fromEnv = env[envName]?.trim();
    if (fromEnv) return fromEnv;
    if ((opts.platform ?? process.platform) !== 'darwin' || keychainOff(env, Boolean(opts.exec)))
      return undefined;
    try {
      return keychainGet(opts.exec ?? realExec, account)?.trim() || undefined;
    } catch {
      return undefined;
    }
  };
}

/** Where each cloud-browser key comes from, and the plain lines `remy search` shows. */
export async function remoteBrowserStatus(
  env: Record<string, string | undefined>,
  opts: ServiceKeyOptions = {},
): Promise<{
  sources: Record<'steel' | 'browserbase' | 'browserbase-project', KeySource>;
  found: { name: string; value: string }[];
  lines: string[];
}> {
  const names = [
    ['steel', 'STEEL_API_KEY'],
    ['browserbase', 'BROWSERBASE_API_KEY'],
    ['browserbase-project', 'BROWSERBASE_PROJECT_ID'],
  ] as const;
  const reads = await Promise.all(names.map(([a, n]) => readServiceKey(n, a, env, opts)));
  const sources = Object.fromEntries(
    names.map(([a], i) => [a, reads[i]?.source ?? 'none']),
  ) as Record<(typeof names)[number][0], KeySource>;
  const found = names.flatMap(([, n], i) => {
    const r = reads[i];
    return r?.source === 'keychain' && r.value ? [{ name: n, value: r.value }] : [];
  });
  const where = (n: string, s: KeySource) =>
    s === 'env' ? `env (${n})` : s === 'keychain' ? 'Keychain' : 'none';
  const want = (env.REMY_BROWSER ?? '').trim().toLowerCase();
  const lines = [
    want === 'steel' || want === 'browserbase'
      ? `Browser: ${SERVICES[want].label}, a cloud browser (REMY_BROWSER=${want}).`
      : 'Browser: on this computer. Optional cloud browser: REMY_BROWSER=steel or browserbase.',
    `  steel       key: ${where('STEEL_API_KEY', sources.steel)}`,
    `  browserbase key: ${where('BROWSERBASE_API_KEY', sources.browserbase)}, project: ${where('BROWSERBASE_PROJECT_ID', sources['browserbase-project'])}`,
  ];
  return { sources, found, lines };
}

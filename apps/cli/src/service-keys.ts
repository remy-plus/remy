// A service key: the environment first, then (macOS, REMY_KEYCHAIN not off) the Keychain under
// service `remy` with the given account. The read never blocks the event loop, gives up on a slow
// or locked Keychain (read as "no key"), and never prints the value.
import { KEYCHAIN_SERVICE, keychainOff } from './credentials.ts';
import { type AsyncExec, KEYCHAIN_TIMEOUT_MS, realAsyncExec } from './serve-voice.ts';

export type KeySource = 'env' | 'keychain' | 'none';

export interface ServiceKeyOptions {
  platform?: NodeJS.Platform;
  exec?: AsyncExec;
  timeoutMs?: number;
}

export async function readServiceKey(
  envName: string,
  account: string,
  env: Record<string, string | undefined>,
  opts: ServiceKeyOptions = {},
): Promise<{ value?: string; source: KeySource }> {
  const fromEnv = env[envName]?.trim();
  if (fromEnv) return { value: fromEnv, source: 'env' };
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin' || keychainOff(env, Boolean(opts.exec))) return { source: 'none' };
  try {
    const r = await (opts.exec ?? realAsyncExec)(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      opts.timeoutMs ?? KEYCHAIN_TIMEOUT_MS,
    );
    const value = r.stdout.replace(/\r?\n$/, '').trim();
    if (r.status === 0 && value) return { value, source: 'keychain' };
  } catch {
    // A locked or slow Keychain is "no key".
  }
  return { source: 'none' };
}

/** Keys for page readers, cloud browsers and a Boat cloud computer that `remy search key <id>` can save. */
export const EXTRA_KEYS = {
  firecrawl: {
    env: 'FIRECRAWL_API_KEY',
    label: 'Firecrawl',
    use: 'reads pages Remy cannot read directly',
  },
  cloudflare: {
    env: 'CLOUDFLARE_API_TOKEN',
    label: 'Cloudflare Browser Rendering token',
    use: 'reads pages Remy cannot read directly (also needs cloudflare-account)',
  },
  'cloudflare-account': {
    env: 'CLOUDFLARE_ACCOUNT_ID',
    label: 'Cloudflare account id',
    use: 'goes with the Cloudflare token for reading pages',
  },
  steel: {
    env: 'STEEL_API_KEY',
    label: 'Steel',
    use: 'a cloud browser, used when REMY_BROWSER=steel',
  },
  browserbase: {
    env: 'BROWSERBASE_API_KEY',
    label: 'Browserbase',
    use: 'a cloud browser, used when REMY_BROWSER=browserbase',
  },
  'browserbase-project': {
    env: 'BROWSERBASE_PROJECT_ID',
    label: 'Browserbase project id',
    use: 'goes with the Browserbase key for the cloud browser',
  },
  boat: {
    env: 'BOAT_API_KEY',
    label: 'Boat API key',
    use: 'lets Remy use your own Boat cloud computer (remy computer add <name> --boat)',
  },
} as const;
export type ExtraKeyId = keyof typeof EXTRA_KEYS;
export const isExtraKey = (v: string | undefined): v is ExtraKeyId =>
  !!v && Object.hasOwn(EXTRA_KEYS, v);

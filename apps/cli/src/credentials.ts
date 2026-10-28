// Saved logins (`remy login`). Keys go to the macOS Keychain when it is there, else to a 0600
// file in REMY_HOME. A small index (no secrets) records which provider is the default and
// each provider's model or base URL.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KEYCHAIN_SERVICE = 'remy';

export type Exec = (
  cmd: string,
  args: string[],
  input?: string,
) => { status: number | null; stdout: string };

export const realExec: Exec = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '' };
};

export interface LoginMeta {
  model?: string;
  baseUrl?: string;
}

export interface SavedLogin extends LoginMeta {
  provider: string;
  /** Empty for providers that need none (a local Ollama). */
  key: string;
}

export interface LoginSummary extends LoginMeta {
  provider: string;
  store: 'keychain' | 'file' | 'none';
  isDefault: boolean;
}

interface Index {
  default?: string;
  providers: Record<string, LoginMeta & { store: 'keychain' | 'file' | 'none' }>;
}

export interface Credentials {
  save(provider: string, key: string, meta?: LoginMeta): LoginSummary['store'];
  load(provider: string): SavedLogin | undefined;
  /** The provider `remy` uses when none is named. */
  defaultProvider(): string | undefined;
  list(): LoginSummary[];
  remove(provider: string): boolean;
}

export interface CredentialsOptions {
  home: string;
  platform?: NodeJS.Platform;
  exec?: Exec;
}

/** Keychain commands are fed on stdin (`security -i`), so a key never shows up in `ps`. */
const SAFE_VALUE = /^[\x20-\x7e]+$/;
const unsafeForKeychain = (value: string) => !SAFE_VALUE.test(value) || /["'\\]/.test(value);

/** Stores a value as a generic password of the `remy` service. False when it cannot be (use a file). */
export function keychainSet(exec: Exec, account: string, value: string): boolean {
  if (unsafeForKeychain(value) || value !== value.trim()) return false;
  // A value with a space (a "Bearer ..." header) is quoted for `security -i`.
  const arg = value.includes(' ') ? `"${value}"` : value;
  const r = exec(
    'security',
    ['-i'],
    `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -w ${arg}\n`,
  );
  return r.status === 0;
}

export function keychainGet(exec: Exec, account: string): string | undefined {
  const r = exec('security', [
    'find-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    account,
    '-w',
  ]);
  const value = r.stdout.replace(/\r?\n$/, '');
  return r.status === 0 && value ? value : undefined;
}

export function keychainDelete(exec: Exec, account: string): void {
  exec('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]);
}

export function openCredentials(o: CredentialsOptions): Credentials {
  const exec = o.exec ?? realExec;
  const keychain = (o.platform ?? process.platform) === 'darwin';
  const indexPath = join(o.home, 'logins.json');
  const filePath = join(o.home, 'credentials.json');

  const ensureHome = () => mkdirSync(o.home, { recursive: true, mode: 0o700 });
  const readJson = <T>(path: string, empty: T): T => {
    if (!existsSync(path)) return empty;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      return empty;
    }
  };
  const writePrivate = (path: string, data: unknown) => {
    ensureHome();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  };
  const index = (): Index => {
    const i = readJson<Partial<Index>>(indexPath, {});
    return { ...(i.default && { default: i.default }), providers: i.providers ?? {} };
  };
  const files = () => readJson<Record<string, string>>(filePath, {});

  const keychainSetKey = (provider: string, key: string) =>
    keychain && keychainSet(exec, provider, key);

  return {
    save(provider, key, meta = {}) {
      const idx = index();
      let store: LoginSummary['store'] = 'none';
      if (key) {
        if (keychainSetKey(provider, key)) store = 'keychain';
        else {
          writePrivate(filePath, { ...files(), [provider]: key });
          store = 'file';
        }
      }
      // A key moved to the keychain must not linger in the file.
      if (store !== 'file') {
        const f = files();
        if (provider in f) {
          delete f[provider];
          writePrivate(filePath, f);
        }
      }
      idx.providers[provider] = {
        store,
        ...(meta.model && { model: meta.model }),
        ...(meta.baseUrl && { baseUrl: meta.baseUrl }),
      };
      idx.default = provider;
      writePrivate(indexPath, idx);
      return store;
    },

    load(provider) {
      const entry = index().providers[provider];
      if (!entry) return undefined;
      const key =
        entry.store === 'keychain'
          ? keychainGet(exec, provider)
          : entry.store === 'file'
            ? files()[provider]
            : '';
      if (key === undefined) return undefined;
      return {
        provider,
        key,
        ...(entry.model && { model: entry.model }),
        ...(entry.baseUrl && { baseUrl: entry.baseUrl }),
      };
    },

    defaultProvider: () => index().default,

    list() {
      const idx = index();
      return Object.entries(idx.providers).map(([provider, e]) => ({
        provider,
        store: e.store,
        isDefault: idx.default === provider,
        ...(e.model && { model: e.model }),
        ...(e.baseUrl && { baseUrl: e.baseUrl }),
      }));
    },

    remove(provider) {
      const idx = index();
      const entry = idx.providers[provider];
      if (!entry) return false;
      if (entry.store === 'keychain') keychainDelete(exec, provider);
      const f = files();
      if (provider in f) {
        delete f[provider];
        writePrivate(filePath, f);
      }
      delete idx.providers[provider];
      if (idx.default === provider) {
        const next = Object.keys(idx.providers)[0];
        if (next) idx.default = next;
        else delete idx.default;
      }
      writePrivate(indexPath, idx);
      return true;
    },
  };
}

// Secrets for connected servers (tokens in env or headers). Same homes as saved logins: the macOS
// Keychain when it is there, else a 0600 file in REMY_HOME. A server's config refers to one as
// "${secret:<name>}", so the config can be shared and checked in without the value in it.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Exec, keychainDelete, keychainGet, keychainSet, realExec } from './credentials.ts';

/** Letters, digits, `_`, `.` and `-`: safe in a Keychain account name and in a config string. */
export const SECRET_NAME = /^[A-Za-z0-9_.-]{1,80}$/;

export interface SecretStore {
  /** Saves a value; returns where it went. */
  set(name: string, value: string): 'keychain' | 'file';
  get(name: string): string | undefined;
  remove(name: string): boolean;
  list(): { name: string; store: 'keychain' | 'file' }[];
}

export interface SecretStoreOptions {
  home: string;
  platform?: NodeJS.Platform;
  exec?: Exec;
}

type Entry = { store: 'keychain' } | { store: 'file'; value: string };

const account = (name: string) => `mcp:${name}`;

export function openSecretStore(o: SecretStoreOptions): SecretStore {
  const exec = o.exec ?? realExec;
  const keychain = (o.platform ?? process.platform) === 'darwin';
  const path = join(o.home, 'mcp-secrets.json');

  const read = (): Record<string, Entry> => {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Entry>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, Entry>) => {
    mkdirSync(o.home, { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  };
  const checked = (name: string) => {
    if (!SECRET_NAME.test(name))
      throw new Error(`"${name}" is not a valid secret name. Use letters, digits, _ . and -.`);
    return name;
  };

  return {
    set(name, value) {
      checked(name);
      if (!value) throw new Error('A secret cannot be empty.');
      const all = read();
      const inKeychain = keychain && keychainSet(exec, account(name), value);
      all[name] = inKeychain ? { store: 'keychain' } : { store: 'file', value };
      write(all);
      return inKeychain ? 'keychain' : 'file';
    },
    get(name) {
      const e = read()[name];
      if (!e) return undefined;
      return e.store === 'keychain' ? keychainGet(exec, account(name)) : e.value;
    },
    remove(name) {
      const all = read();
      const e = all[name];
      if (!e) return false;
      if (e.store === 'keychain') keychainDelete(exec, account(name));
      delete all[name];
      write(all);
      return true;
    },
    list: () => Object.entries(read()).map(([name, e]) => ({ name, store: e.store })),
  };
}

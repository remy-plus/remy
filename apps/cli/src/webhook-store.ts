// Webhooks on disk, in REMY_HOME/webhooks.json (0600), written whole. A hook is a saved prompt with
// a name; it holds no secret except the hash of its own token, if it has one. Listening is off
// until the user runs `remy webhook enable`.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Hook {
  name: string;
  prompt: string;
  createdAt: string;
  /** SHA-256 of this hook's own token, hex. When set, the shared token does not open this hook. */
  tokenHash?: string;
}

export interface HookFile {
  enabled: boolean;
  hooks: Hook[];
}

export interface HookStore {
  list(): Hook[];
  get(name: string): Hook | undefined;
  add(name: string, prompt: string, now: Date): Hook;
  remove(name: string): boolean;
  /** Sets or clears (undefined) the hook's own token hash. */
  setTokenHash(name: string, hash: string | undefined): boolean;
  enabled(): boolean;
  setEnabled(on: boolean): void;
}

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const PROMPT_MAX = 2000;

export const validName = (name: string): boolean => NAME_RE.test(name);

export function openHooks(home: string): HookStore {
  const path = join(home, 'webhooks.json');
  const read = (): HookFile => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<HookFile>;
      const hooks = Array.isArray(raw.hooks)
        ? raw.hooks.filter(
            (h): h is Hook =>
              !!h &&
              typeof h.name === 'string' &&
              validName(h.name) &&
              typeof h.prompt === 'string',
          )
        : [];
      return { enabled: raw.enabled === true, hooks };
    } catch {
      return { enabled: false, hooks: [] };
    }
  };
  const write = (file: HookFile) => {
    mkdirSync(home, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  };
  return {
    list: () => read().hooks,
    get: (name) => read().hooks.find((h) => h.name === name),
    add(name, prompt, now) {
      if (!validName(name))
        throw new Error(
          'A hook name is 1 to 40 characters: lowercase letters, digits, - and _, starting with a letter or digit.',
        );
      const text = prompt.trim();
      if (!text) throw new Error('A hook needs a prompt.');
      if (text.length > PROMPT_MAX)
        throw new Error(`A hook prompt is at most ${PROMPT_MAX} characters.`);
      const file = read();
      if (file.hooks.some((h) => h.name === name))
        throw new Error(`There is already a hook ${name}.`);
      const hook: Hook = { name, prompt: text, createdAt: now.toISOString() };
      write({ ...file, hooks: [...file.hooks, hook] });
      return hook;
    },
    remove(name) {
      const file = read();
      const hooks = file.hooks.filter((h) => h.name !== name);
      if (hooks.length === file.hooks.length) return false;
      write({ ...file, hooks });
      return true;
    },
    setTokenHash(name, hash) {
      const file = read();
      if (!file.hooks.some((h) => h.name === name)) return false;
      write({
        ...file,
        hooks: file.hooks.map((h) => {
          if (h.name !== name) return h;
          const { tokenHash: _drop, ...rest } = h;
          return hash ? { ...rest, tokenHash: hash } : rest;
        }),
      });
      return true;
    },
    enabled: () => read().enabled,
    setEnabled(on) {
      write({ ...read(), enabled: on });
    },
  };
}

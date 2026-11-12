// The folder Remy may use: how a typed path is checked, which folder a task gets, and the route.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEventStore } from '@remy/store';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiCtx } from './serve.ts';
import {
  checkWorkspace,
  chooseWorkspace,
  openWebPrefs,
  type prefsPatch,
  settingsRoutes,
} from './serve-settings.ts';

let base: string;
let userHome: string;
let home: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'remy-ws-')));
  userHome = join(base, 'me');
  home = join(userHome, '.remy');
  mkdirSync(join(userHome, 'Documents', 'Projects'), { recursive: true });
  mkdirSync(home, { recursive: true });
});

const refusal = (path: string) => {
  try {
    checkWorkspace(path, home, userHome);
  } catch (e) {
    return e as Error & { status: number };
  }
  throw new Error('expected a refusal');
};

describe('checkWorkspace', () => {
  it('stores the real path of a good folder, with ~ expanded', () => {
    const dir = join(userHome, 'Documents', 'Projects');
    expect(checkWorkspace(dir, home, userHome)).toBe(dir);
    expect(checkWorkspace('~/Documents/Projects', home, userHome)).toBe(dir);
    expect(checkWorkspace(`  ${dir}  `, home, userHome)).toBe(dir);
  });

  it('stores where a symlink really points', () => {
    const link = join(userHome, 'link');
    symlinkSync(join(userHome, 'Documents', 'Projects'), link);
    expect(checkWorkspace(link, home, userHome)).toBe(join(userHome, 'Documents', 'Projects'));
  });

  it('refuses each folder Remy should not be given, in plain words', () => {
    const file = join(userHome, 'a.txt');
    writeFileSync(file, 'x');
    const cases: [string, RegExp][] = [
      ['Documents/Projects', /full path/],
      [join(userHome, 'nope'), /does not exist/],
      [file, /file, not a folder/],
      ['/', /not the whole disk/],
      [userHome, /not the whole home folder/],
      ['~', /not the whole home folder/],
      [home, /own data and keys/],
      [join(home, 'workspaces'), /does not exist/],
      [base, /own data and keys/],
    ];
    for (const [path, message] of cases) {
      const e = refusal(path);
      expect(e.status, path).toBe(400);
      expect(e.message, path).toMatch(message);
      expect(e.message).not.toContain('!');
    }
  });

  it('refuses keys, system settings and anything outside home', () => {
    for (const d of ['.ssh', '.aws', '.gnupg', '.config', '.kube', '.password-store', 'Library']) {
      mkdirSync(join(userHome, d, 'sub'), { recursive: true });
      for (const p of [join(userHome, d), join(userHome, d, 'sub')]) {
        const e = refusal(p);
        expect(e.status, p).toBe(400);
        expect(e.message, p).toMatch(/keys or system settings/);
      }
    }
    mkdirSync(join(userHome, 'Library', 'Keychains'), { recursive: true });
    expect(refusal('~/LIBRARY/Keychains').message).toMatch(
      /keys or system settings|does not exist/,
    );
    mkdirSync(join(userHome, '.local', 'share', 'keyrings'), { recursive: true });
    expect(refusal(join(userHome, '.local', 'share', 'keyrings')).message).toMatch(/keys or/);
    expect(refusal(join(base)).message).toMatch(/own data|inside your home/);
    expect(refusal('/etc').message).toMatch(/inside your home folder/);
    const link = join(userHome, 'sneak');
    symlinkSync(join(userHome, '.ssh'), link);
    expect(refusal(link).message).toMatch(/keys or system settings/);
  });

  it('accepts ordinary folders under home', () => {
    mkdirSync(join(userHome, 'Documents', 'x'), { recursive: true });
    mkdirSync(join(userHome, 'Projects', 'x'), { recursive: true });
    expect(checkWorkspace('~/Documents/x', home, userHome)).toBe(join(userHome, 'Documents', 'x'));
    expect(checkWorkspace('~/Projects/x', home, userHome)).toBe(join(userHome, 'Projects', 'x'));
  });

  it('refuses a folder inside Remy data, and a link into it', () => {
    mkdirSync(join(home, 'workspaces', 't1'), { recursive: true });
    expect(refusal(join(home, 'workspaces', 't1')).message).toMatch(/own data/);
    const link = join(userHome, 'sneaky');
    symlinkSync(join(home, 'workspaces'), link);
    expect(refusal(link).message).toMatch(/own data/);
  });
});

describe('chooseWorkspace', () => {
  it('prefers the flag, then the saved setting, then a folder per task', () => {
    expect(chooseWorkspace('/flag', '/pref', '/t')).toEqual({ folder: '/flag', source: 'flag' });
    expect(chooseWorkspace(undefined, '/pref', '/t')).toEqual({
      folder: '/pref',
      source: 'setting',
    });
    expect(chooseWorkspace(undefined, null, '/t')).toEqual({ folder: '/t', source: 'task' });
    expect(chooseWorkspace(undefined, undefined, '/t')).toEqual({ folder: '/t', source: 'task' });
  });
});

describe('settings route', () => {
  const route = (flag?: string) => {
    const prefs = openWebPrefs(home);
    const r = settingsRoutes(
      {
        home,
        store: new MemoryEventStore(),
        prefs,
        version: '1',
        modelId: 'm',
        address: () => 'a',
        notesCount: () => 0,
        workspaceFlag: flag,
        userHome,
      },
      async () => 0,
    );
    const call = async (method: string, body?: unknown) => {
      const ctx = {
        parts: ['settings'],
        method,
        body: async (schema: typeof prefsPatch) => schema.parse(body),
      } as unknown as ApiCtx;
      return r(ctx) as Promise<{ status: number; body: { workspace: unknown } }>;
    };
    return { call, prefs };
  };

  it('saves the real path, reports it, and clears it', async () => {
    const { call, prefs } = route();
    expect((await call('GET')).body.workspace).toEqual({ path: null, source: 'task', saved: null });
    const dir = join(userHome, 'Documents', 'Projects');
    const put = await call('PUT', { workspace: '~/Documents/Projects' });
    expect(put.body.workspace).toEqual({ path: dir, source: 'setting', saved: dir });
    expect(prefs.get().workspace).toBe(dir);
    const cleared = await call('PUT', { workspace: null });
    expect(cleared.body.workspace).toEqual({ path: null, source: 'task', saved: null });
  });

  it('answers 400 for a folder it refuses and keeps what was saved', async () => {
    const { call, prefs } = route();
    await expect(call('PUT', { workspace: join(userHome, 'nope') })).rejects.toMatchObject({
      status: 400,
    });
    expect(prefs.get().workspace).toBeNull();
  });

  it('shows the flag as the folder in use while keeping the saved setting', async () => {
    const { call } = route('/flag/dir');
    const dir = join(userHome, 'Documents', 'Projects');
    await call('PUT', { workspace: dir });
    expect((await call('GET')).body.workspace).toEqual({
      path: '/flag/dir',
      source: 'flag',
      saved: dir,
    });
  });
});

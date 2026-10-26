import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ScopedFs } from '@remy/core';

export class ScopeError extends Error {
  override name = 'ScopeError';
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/**
 * What the file tools need beyond core's ScopedFs. `ToolContext.fs` is typed as the narrow
 * interface, so tools reach these through `fullFs(ctx.fs)`.
 */
export interface ScopedFsFull extends ScopedFs {
  /** Absolute workspace root. */
  readonly root: string;
  /** Absolute path for a workspace-relative one, after the same escape checks as every other call. */
  resolvePath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  move(from: string, to: string): Promise<void>;
  /** Delete one file. A missing file is not an error; a directory is. */
  remove(path: string): Promise<void>;
  makeDir(path: string): Promise<void>;
}

export const fullFs = (fs: ScopedFs): ScopedFsFull => {
  const f = fs as Partial<ScopedFsFull>;
  if (!f.move || !f.remove || !f.makeDir || !f.resolvePath || !f.exists || !f.root) {
    throw new Error('This tool needs a workspace filesystem that supports file management');
  }
  return fs as ScopedFsFull;
};

export function createScopedFs(root: string, opts: { maxBytes?: number } = {}): ScopedFsFull {
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const base = resolve(root);
  let realBase: Promise<string> | undefined;
  const jail = () => {
    realBase ??= realpath(base);
    return realBase;
  };

  const lexical = (p: string): string => {
    if (typeof p !== 'string' || p === '' || isAbsolute(p)) {
      throw new ScopeError(`path must be relative to the workspace: ${JSON.stringify(p)}`);
    }
    const full = resolve(base, p);
    if (!inside(base, full)) throw new ScopeError(`path escapes the workspace: ${p}`);
    return full;
  };

  // Realpath of the deepest existing ancestor (the path itself when it exists).
  const anchor = async (full: string): Promise<string> => {
    for (let cur = full; ; cur = dirname(cur)) {
      try {
        await lstat(cur);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && cur !== dirname(cur)) continue;
        throw e;
      }
      try {
        return await realpath(cur);
      } catch {
        throw new ScopeError('path is a broken symlink'); // can't prove where it points
      }
    }
  };

  const check = async (p: string): Promise<string> => {
    const full = lexical(p);
    if (!inside(await jail(), await anchor(full))) {
      throw new ScopeError(`path escapes the workspace: ${p}`);
    }
    return full;
  };

  return {
    root: base,
    async resolvePath(p) {
      return check(p);
    },
    async exists(p) {
      const full = await check(p);
      return lstat(full).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      );
    },
    async move(from, to) {
      const src = await check(from);
      const dest = await check(to);
      await lstat(src); // throws ENOENT when the source is missing
      const taken = await lstat(dest).then(
        () => true,
        () => false,
      );
      if (taken) throw new Error(`Destination already exists: ${to}`);
      await mkdir(dirname(dest), { recursive: true });
      await check(to); // parents exist now; re-verify
      await rename(src, dest);
    },
    async remove(p) {
      const full = await check(p);
      const st = await lstat(full).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (!st) return;
      if (st.isDirectory()) throw new Error(`${p} is a folder; delete_file only deletes files`);
      await rm(full);
    },
    async makeDir(p) {
      const full = await check(p);
      await mkdir(full, { recursive: true });
      await check(p); // re-verify once the folders exist
    },
    async readText(p) {
      const full = await check(p);
      const size = (await stat(full)).size;
      if (size > maxBytes) throw new Error(`File too large: ${size} bytes (limit ${maxBytes})`);
      return readFile(full, 'utf8');
    },
    async writeText(p, content) {
      const size = Buffer.byteLength(content);
      if (size > maxBytes) throw new Error(`Content too large: ${size} bytes (limit ${maxBytes})`);
      const full = await check(p);
      await mkdir(dirname(full), { recursive: true });
      await check(p); // parents exist now; re-verify
      await writeFile(full, content);
    },
    async list(p) {
      const full = await check(p);
      const entries = await readdir(full, { withFileTypes: true });
      return entries
        .map((e) => ({ name: e.name, dir: e.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
  };
}

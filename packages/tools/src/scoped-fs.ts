import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ScopedFs } from '@remy/core';

export class ScopeError extends Error {
  override name = 'ScopeError';
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export function createScopedFs(root: string, opts: { maxBytes?: number } = {}): ScopedFs {
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

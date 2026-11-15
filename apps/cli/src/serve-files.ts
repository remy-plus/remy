// `remy serve` routes for the files a task wrote, so the web app can offer them as downloads.
//
//   GET /api/tasks/:id/files                 the files the task wrote and that are still there
//   GET /api/tasks/:id/files/download?path=  one of them, as an attachment
//
// Only a file the task itself wrote (a finished write_file, edit_file or the target of a
// move_file) is ever offered, and only from that task's own workspace: the folder is read from the
// task's events, never from the request. A path in the request must be relative, free of `..` and
// of dotfiles (`.env`, `.git`), must name a file on that list, and must still resolve, symlinks
// followed, to a regular file inside the workspace. Files over 25 MB are not offered.
import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type EventStore, fold, type TaskState } from '@remy/core';
import { guard, HttpFail, ID_RE, type Mount, methodNotAllowed, ok } from './serve-mount.ts';

export const FILE_MAX_BYTES = 25 * 1024 * 1024;
const FILES_MAX = 50;
const PATH_MAX = 500;

export interface WrittenFile {
  /** Relative to the task's workspace, with `/` separators. */
  path: string;
  name: string;
  size: number;
}

/** A relative path a person or a model could mean, cleaned; undefined for anything unsafe. */
function cleanRelative(raw: string): string | undefined {
  if (!raw || raw.length > PATH_MAX || raw.includes('\0') || raw.includes('\\')) return undefined;
  if (isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) return undefined;
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) return undefined;
  // `..` is refused outright, and so is any dotfile or dot-folder along the way.
  if (parts.some((p) => p.startsWith('.'))) return undefined;
  return parts.join('/');
}

/** The paths a task's finished write calls named, oldest first, relative to its workspace. */
export function writtenPaths(state: TaskState): string[] {
  const root = state.config.workspaceDir;
  const out: string[] = [];
  const add = (arg: unknown) => {
    if (typeof arg !== 'string') return;
    // The tools take paths inside the workspace; an absolute one is only kept if it is inside it.
    const rel = isAbsolute(arg) ? relative(root, arg) : arg;
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    const clean = cleanRelative(rel);
    if (clean && !out.includes(clean)) out.push(clean);
  };
  const calls = Object.values(state.calls).sort((a, b) => a.step - b.step);
  for (const c of calls) {
    if (!c.result?.ok) continue;
    const args = (c.args ?? {}) as Record<string, unknown>;
    if (c.tool === 'write_file' || c.tool === 'edit_file') add(args.path);
    else if (c.tool === 'move_file') add(args.to);
  }
  return out;
}

/** The real file behind a relative path, or undefined unless it is a regular file inside `root`. */
function resolveInside(root: string, rel: string): { full: string; size: number } | undefined {
  try {
    const realRoot = realpathSync(root);
    const full = realpathSync(resolve(realRoot, rel));
    const inside = relative(realRoot, full);
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      return undefined;
    // Every part of the real path is checked again: a link may not lead into a dotfile either.
    if (inside.split(sep).some((p) => p.startsWith('.'))) return undefined;
    const st = lstatSync(full);
    if (!st.isFile()) return undefined;
    return { full, size: st.size };
  } catch {
    return undefined;
  }
}

/** The files a task wrote that are still there, readable and not too large. */
export function filesOf(state: TaskState): WrittenFile[] {
  const out: WrittenFile[] = [];
  for (const path of writtenPaths(state)) {
    const f = resolveInside(state.config.workspaceDir, path);
    if (!f || f.size > FILE_MAX_BYTES) continue;
    out.push({ path, name: path.split('/').at(-1) ?? path, size: f.size });
    if (out.length >= FILES_MAX) break;
  }
  return out;
}

/** A Content-Disposition value that survives any file name. */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;
}

export interface FilesMountDeps {
  store: Pick<EventStore, 'read'>;
}

export function createFilesMount(d: FilesMountDeps): Mount {
  const stateOf = async (id: string): Promise<TaskState> => {
    if (!ID_RE.test(id)) throw new HttpFail(404, 'There is no such task.');
    const events = await d.store.read(id);
    if (events.length === 0) throw new HttpFail(404, 'There is no such task.');
    return fold(events);
  };

  return guard(async ({ method, parts, url }) => {
    const [head, id, tail, action] = parts;
    if (head !== 'tasks' || tail !== 'files' || id === undefined) return undefined;
    if (parts.length === 3) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return ok({ files: filesOf(await stateOf(id)) });
    }
    if (parts.length !== 4 || action !== 'download') return undefined;
    if (method !== 'GET') return methodNotAllowed('GET');
    const state = await stateOf(id);
    const asked = url.searchParams.get('path') ?? '';
    const clean = cleanRelative(asked);
    // A path that is not plain and relative is refused before anything on disk is looked at.
    if (!clean) throw new HttpFail(400, 'That is not a file Remy made.');
    if (!writtenPaths(state).includes(clean))
      throw new HttpFail(404, 'Remy did not make that file.');
    const f = resolveInside(state.config.workspaceDir, clean);
    if (!f) throw new HttpFail(404, 'That file is gone now.');
    if (f.size > FILE_MAX_BYTES) throw new HttpFail(413, 'That file is too large to download.');
    const body = await readFile(f.full);
    return {
      status: 200,
      body,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': attachment(clean.split('/').at(-1) ?? 'file'),
        'content-length': String(body.length),
      },
    };
  });
}

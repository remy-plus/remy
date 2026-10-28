// Pure helpers for what a sidebar shows: the session title and the files touched.
import { isAbsolute, relative } from 'node:path';
import { truncate } from './format.ts';

export const TITLE_MAX = 48;
export const FILES_MAX = 20;

export interface FileTouch {
  /** Workspace-relative path. */
  path: string;
  /** How many times it was written, edited, moved or deleted this session. */
  edits: number;
}

/** First message as a single line of at most `TITLE_MAX` characters. */
export function sessionTitle(text: string, pasted: string[] = []): string {
  let typed = text;
  for (const seg of pasted) typed = typed.split(seg).join(' ');
  return truncate(typed, TITLE_MAX);
}

/** A path relative to the workspace, without `./`. Paths outside it are returned as given. */
export function workspacePath(path: string, root?: string): string {
  let p = path.trim();
  if (root && isAbsolute(p)) {
    const rel = relative(root, p);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) p = rel;
  }
  return p.replace(/^(\.\/)+/, '');
}

/** The paths a tool call changes, or none for tools that only read. */
export function changedPaths(tool: string, args: unknown): string[] {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? [v] : []);
  switch (tool) {
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
      return s(a.path);
    case 'move_file':
      return [...s(a.from), ...s(a.to)];
    default:
      return [];
  }
}

/** Counts the paths in, most recent first, capped. A path touched again moves to the front. */
export function touchFiles(list: FileTouch[], paths: string[], max = FILES_MAX): FileTouch[] {
  let out = list;
  for (const path of paths) {
    const prior = out.find((f) => f.path === path);
    out = [{ path, edits: (prior?.edits ?? 0) + 1 }, ...out.filter((f) => f.path !== path)];
  }
  return out.slice(0, max);
}

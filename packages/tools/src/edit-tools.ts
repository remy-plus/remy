import { defineTool, type ToolResult } from '@remy/core';
import { z } from 'zod';
import { fullFs } from './scoped-fs.ts';

const fail = (e: unknown): ToolResult => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  retryable: false,
  phase: 'before_effect',
});

const ok = (content: string): ToolResult => ({ ok: true, content, trust: 'trusted' });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

export const editFile = defineTool({
  name: 'edit_file',
  description:
    'Change part of a workspace file: replace the exact text "old" with "new". "old" must match once, character for character, unless all is true. Read the file first.',
  args: z.object({
    path: z.string().describe('Relative path, e.g. src/app.ts'),
    old: z.string().min(1).describe('Exact text to replace, copied from the file'),
    new: z.string().describe('Replacement text (may be empty to delete)'),
    all: z.boolean().default(false).describe('Replace every match instead of requiring one'),
  }),
  risk: 'write',
  // Same reasoning as write_file: the same call leaves the same file. A retry after the edit
  // landed fails with "not found", which is safe; the model re-reads the file.
  effect: 'idempotent',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 2_000,
  preview: ({ path, old, new: next }) =>
    `Edit ${path}: replace "${clip(old, 80)}" with "${clip(next, 80)}"`,
  async execute({ path, old, new: next, all }, ctx) {
    try {
      const text = await ctx.fs.readText(path);
      const parts = text.split(old);
      const count = parts.length - 1;
      if (count === 0) {
        return fail(
          `The text to replace was not found in ${path}. Read the file and copy it exactly.`,
        );
      }
      if (count > 1 && !all) {
        return fail(
          `The text to replace appears ${count} times in ${path}. Include more surrounding text so it matches once, or set all to true.`,
        );
      }
      const at = text.indexOf(old);
      await ctx.fs.writeText(path, parts.join(next));
      // Show the first changed region with a little context so the model can verify it.
      const region = `${text.slice(Math.max(0, at - 40), at)}${next}${text.slice(at + old.length, at + old.length + 40)}`;
      return ok(
        `Replaced ${count} ${count === 1 ? 'match' : 'matches'} in ${path}. Now reads: ${JSON.stringify(region)}`,
      );
    } catch (e) {
      return fail(e);
    }
  },
});

export const moveFile = defineTool({
  name: 'move_file',
  description:
    'Move or rename a file or folder in the workspace. Fails if the destination already exists.',
  args: z.object({
    from: z.string().describe('Relative path of the existing file or folder'),
    to: z.string().describe('Relative path of the new location'),
  }),
  risk: 'write',
  effect: 'reconcilable',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 2_000,
  preview: ({ from, to }) => `Move ${from} to ${to}`,
  async execute({ from, to }, ctx) {
    try {
      await fullFs(ctx.fs).move(from, to);
      return ok(`Moved ${from} to ${to}`);
    } catch (e) {
      return fail(e);
    }
  },
  // Done when the source is gone and the destination exists.
  async reconcile({ from, to }, ctx) {
    try {
      const fs = fullFs(ctx.fs);
      if (!(await fs.exists(from)) && (await fs.exists(to))) {
        return { done: true, result: ok(`Moved ${from} to ${to}`) };
      }
    } catch {
      // not provably done
    }
    return { done: false };
  },
});

export const deleteFile = defineTool({
  name: 'delete_file',
  description:
    'Delete one file from the workspace. This cannot be undone. Does not delete folders.',
  args: z.object({ path: z.string().describe('Relative path of the file to delete') }),
  risk: 'irreversible',
  effect: 'idempotent', // deleting a file that is already gone succeeds
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 2_000,
  preview: ({ path }) => `Permanently delete the file ${path}`,
  async execute({ path }, ctx) {
    try {
      await fullFs(ctx.fs).remove(path);
      return ok(`Deleted ${path}`);
    } catch (e) {
      return fail(e);
    }
  },
});

export const makeDir = defineTool({
  name: 'make_dir',
  description: 'Create a folder in the workspace, including missing parent folders.',
  args: z.object({ path: z.string().describe('Relative folder path, e.g. reports/2026') }),
  risk: 'write',
  effect: 'idempotent',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 2_000,
  preview: ({ path }) => `Create the folder ${path}`,
  async execute({ path }, ctx) {
    try {
      await fullFs(ctx.fs).makeDir(path);
      return ok(`Created the folder ${path}`);
    } catch (e) {
      return fail(e);
    }
  },
});

import { defineTool, type ToolResult } from '@remy/core';
import { z } from 'zod';

const fail = (e: unknown): ToolResult => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  retryable: false,
  phase: 'before_effect',
});

const ok = (content: string): ToolResult => ({ ok: true, content, trust: 'trusted' });

export const readFile = defineTool({
  name: 'read_file',
  description: 'Read a text file from the workspace. Paths are relative to the workspace root.',
  args: z.object({ path: z.string().describe('Relative path, e.g. notes/todo.txt') }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 50_000,
  preview: ({ path }) => `Read the file ${path}`,
  async execute({ path }, ctx) {
    try {
      return ok(await ctx.fs.readText(path));
    } catch (e) {
      return fail(e);
    }
  },
});

export const writeFile = defineTool({
  name: 'write_file',
  description:
    'Write a text file in the workspace, replacing it if it exists. Creates missing folders.',
  args: z.object({
    path: z.string().describe('Relative path, e.g. reports/summary.md'),
    content: z.string().describe('Full new contents of the file'),
  }),
  risk: 'write',
  effect: 'idempotent',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 2_000,
  preview: ({ path, content }) =>
    `Write ${content.length} characters to ${path}, replacing it if it exists`,
  async execute({ path, content }, ctx) {
    try {
      await ctx.fs.writeText(path, content);
      return ok(`Wrote ${content.length} characters to ${path}`);
    } catch (e) {
      return fail(e);
    }
  },
});

export const listFiles = defineTool({
  name: 'list_files',
  description: 'List the files and folders in a workspace directory. Folders end with a slash.',
  args: z.object({
    path: z.string().default('.').describe('Relative directory, "." for the root'),
  }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 15_000,
  maxOutputChars: 50_000,
  preview: ({ path }) => `List the files in ${path}`,
  async execute({ path }, ctx) {
    try {
      const entries = await ctx.fs.list(path);
      return ok(
        entries.length ? entries.map((e) => e.name + (e.dir ? '/' : '')).join('\n') : '(empty)',
      );
    } catch (e) {
      return fail(e);
    }
  },
});

export const finish = defineTool({
  name: 'finish',
  description: 'Give the final answer and end the task. Call this once the work is done.',
  args: z.object({ answer: z.string().describe('The final answer for the user') }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 5_000,
  maxOutputChars: 50_000,
  preview: ({ answer }) => `Finish with: ${answer.slice(0, 200)}`,
  async execute({ answer }) {
    return ok(answer);
  },
});

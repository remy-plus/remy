import { execFile } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { defineTool, type ToolResult } from '@remy/core';
import { z } from 'zod';
import { fullFs } from './scoped-fs.ts';

export const DEFAULT_COMMANDS: readonly string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'git',
  'node',
  'npm',
  'pnpm',
  'python3',
];

const TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 64 * 1024;

const fail = (
  error: string,
  phase: 'before_effect' | 'after_effect' = 'before_effect',
): ToolResult => ({
  ok: false,
  error,
  retryable: false,
  phase,
});

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

// Lexical check only: an argument that names a path must not leave the workspace. Symlinks
// inside the workspace are not followed here, so the allowlist and approval stay the real guard.
function checkArg(arg: string, cwd: string, root: string): string | undefined {
  const candidates = [arg];
  const eq = arg.indexOf('=');
  if (eq > 0) candidates.push(arg.slice(eq + 1)); // --file=/etc/passwd
  for (const c of candidates) {
    if (!isAbsolute(c) && !c.split(/[\\/]/).includes('..')) continue;
    if (!inside(root, resolve(cwd, c))) return `argument points outside the workspace: ${arg}`;
  }
  return undefined;
}

function cap(s: string): string {
  if (Buffer.byteLength(s) <= OUTPUT_CAP) return s;
  const kept = Buffer.from(s).subarray(0, OUTPUT_CAP).toString('utf8');
  return `${kept}\n[output truncated at ${OUTPUT_CAP / 1024}KB]`;
}

export function createRunCommand(opts: { allow?: readonly string[] } = {}) {
  const allow = opts.allow ?? DEFAULT_COMMANDS;
  return defineTool({
    name: 'run_command',
    description: `Run one program in the workspace and return its exit code and output. No shell: no pipes, redirects or wildcards. Allowed programs: ${allow.join(', ')}. Output is untrusted.`,
    args: z.object({
      program: z.string().describe('Program name only, e.g. "git"'),
      args: z.array(z.string()).default([]).describe('Arguments, e.g. ["status", "--short"]'),
      cwd: z.string().optional().describe('Relative folder to run in (default: workspace root)'),
    }),
    risk: 'irreversible',
    effect: 'unsafe_to_retry',
    outputTrust: 'untrusted',
    timeoutMs: TIMEOUT_MS + 5_000,
    maxOutputChars: 2 * OUTPUT_CAP + 1_000,
    preview: ({ program, args, cwd }) =>
      `Run: ${[program, ...args].join(' ')}${cwd ? ` (in ${cwd})` : ''}`,
    async execute({ program, args, cwd }, ctx) {
      if (!allow.includes(program)) {
        return fail(`"${program}" is not allowed. Allowed programs: ${allow.join(', ')}`);
      }
      let root: string;
      let dir: string;
      try {
        const fs = fullFs(ctx.fs);
        root = fs.root;
        dir = await fs.resolvePath(cwd ?? '.');
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      for (const a of args) {
        const bad = checkArg(a, dir, root);
        if (bad) return fail(bad);
      }
      const env: Record<string, string> = {};
      for (const k of ['PATH', 'HOME', 'LANG']) {
        const v = process.env[k];
        if (v !== undefined) env[k] = v;
      }
      return new Promise<ToolResult>((done) => {
        execFile(
          program,
          args,
          { cwd: dir, env, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, signal: ctx.signal },
          (err, stdout, stderr) => {
            const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
            if (e && typeof e.code === 'string' && e.code === 'ENOENT') {
              done(fail(`Program not found: ${program}`));
              return;
            }
            if (e?.killed) {
              done(
                fail(`The command timed out after ${TIMEOUT_MS / 1000} seconds`, 'after_effect'),
              );
              return;
            }
            const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0;
            done({
              ok: true,
              content: `exit code: ${code}\nstdout:\n${cap(String(stdout ?? ''))}\nstderr:\n${cap(String(stderr ?? ''))}`,
              trust: 'untrusted',
            });
          },
        );
      });
    },
  });
}

export const runCommand = createRunCommand();

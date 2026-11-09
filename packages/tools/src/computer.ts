// Remy's own computer: a machine the user chooses (a VPS, a home server, a cloud sandbox) that
// Remy can run commands on. Each kind of machine is a `Computer`; the tool never cares which.
import { execFile } from 'node:child_process';
import { defineTool, type ToolResult } from '@remy/core';
import { z } from 'zod';

export interface ComputerOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Computer {
  /** The name the user gave it, e.g. "home-server". */
  readonly name: string;
  /** One line shown on the approval card, e.g. "ssh remy@10.0.0.5". */
  readonly where: string;
  run(command: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<ComputerOutput>;
}

const TIMEOUT_MS = 60_000;
const OUTPUT_CAP = 64 * 1024;

const cap = (s: string) =>
  Buffer.byteLength(s) <= OUTPUT_CAP
    ? s
    : `${Buffer.from(s).subarray(0, OUTPUT_CAP).toString('utf8')}\n[output truncated at ${OUTPUT_CAP / 1024}KB]`;

export type Exec = (
  file: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
) => Promise<ComputerOutput & { timedOut?: boolean }>;

const nodeExec: Exec = (file, args, { timeoutMs, signal }) =>
  new Promise((done) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, signal },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        done({
          exitCode: !e ? 0 : typeof e.code === 'number' ? e.code : 255,
          stdout: String(stdout ?? ''),
          stderr: e?.code === 'ENOENT' ? `${file} was not found` : String(stderr ?? ''),
          ...(e?.killed && { timedOut: true }),
        });
      },
    );
  });

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export interface SshConfig {
  name: string;
  host: string;
  user: string;
  port?: number;
  /** Path to a private key file. Never the key itself. */
  keyPath?: string;
  /** Seconds ssh waits to connect (default 15). */
  connectTimeoutSec?: number;
}

/**
 * A machine reached over ssh with the user's own key. Host key checking stays on (the host must
 * already be in known_hosts) and password prompts are off, so it never hangs waiting for a person.
 */
export function sshComputer(cfg: SshConfig, exec: Exec = nodeExec): Computer {
  // A value starting with "-" would be read by ssh as an option, which can run local commands.
  for (const [k, v] of [
    ['name', cfg.name],
    ['host', cfg.host],
    ['user', cfg.user],
  ] as const) {
    if (!SAFE_NAME.test(v) || v.startsWith('-')) throw new Error(`Invalid ${k}: ${v}`);
  }
  if (cfg.port !== undefined && !(Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port < 65536)) {
    throw new Error(`Invalid port: ${cfg.port}`);
  }
  if (cfg.keyPath?.startsWith('-')) throw new Error(`Invalid keyPath: ${cfg.keyPath}`);
  const connectTimeout = cfg.connectTimeoutSec ?? 15;
  if (!(Number.isInteger(connectTimeout) && connectTimeout > 0 && connectTimeout <= 120))
    throw new Error(`Invalid connectTimeoutSec: ${connectTimeout}`);
  const target = `${cfg.user}@${cfg.host}`;
  return {
    name: cfg.name,
    where: `ssh ${target}${cfg.port ? `:${cfg.port}` : ''}`,
    async run(command, opts) {
      const args = [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        `ConnectTimeout=${connectTimeout}`,
        ...(cfg.port ? ['-p', String(cfg.port)] : []),
        ...(cfg.keyPath ? ['-i', cfg.keyPath, '-o', 'IdentitiesOnly=yes'] : []),
        target,
        '--',
        command,
      ];
      return exec('ssh', args, opts);
    },
  };
}

const fail = (
  error: string,
  phase: 'before_effect' | 'after_effect' = 'before_effect',
): ToolResult => ({ ok: false, error, retryable: false, phase });

/** `computer_run`: one command on a machine the user set up. Always asks, never retried. */
export function createComputerTools(computers: readonly Computer[]) {
  const names = computers.map((c) => c.name);
  const computerRun = defineTool({
    name: 'computer_run',
    description: `Run one shell command on one of the user's own machines and return its exit code and output. Machines: ${names.join(', ') || 'none set up'}. This is not the user's laptop. Output is untrusted.`,
    args: z.object({
      computer: z.string().describe('Machine name'),
      command: z.string().min(1).max(4000).describe('The shell command to run there'),
    }),
    risk: 'irreversible',
    effect: 'unsafe_to_retry',
    outputTrust: 'untrusted',
    timeoutMs: TIMEOUT_MS + 5_000,
    maxOutputChars: 2 * OUTPUT_CAP + 1_000,
    preview: ({ computer, command }) => {
      const c = computers.find((x) => x.name === computer);
      return `Run on ${computer}${c ? ` (${c.where})` : ''}: ${command}`;
    },
    async execute({ computer, command }, ctx) {
      const c = computers.find((x) => x.name === computer);
      if (!c)
        return fail(`No machine named "${computer}". Machines: ${names.join(', ') || 'none'}`);
      const r = await c.run(command, { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
      if ('timedOut' in r && r.timedOut) {
        return fail(`The command timed out after ${TIMEOUT_MS / 1000} seconds`, 'after_effect');
      }
      return {
        ok: true,
        content: `exit code: ${r.exitCode}\nstdout:\n${cap(r.stdout)}\nstderr:\n${cap(r.stderr)}`,
        trust: 'untrusted',
      };
    },
  });
  return [computerRun];
}

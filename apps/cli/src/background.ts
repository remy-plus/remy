// Background tasks: a detached worker process drives a task on the same event log. The log is the
// source of truth; the marker file only says "a worker was started for this task" and its pid.
import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStatus } from '@remy/core';
import { truncate } from './format.ts';

export interface BgMarker {
  pid: number;
  startedAt: string;
}

export interface SpawnOptions {
  detached: true;
  stdio: ['ignore', number, number];
  env: Record<string, string | undefined>;
  cwd: string;
}
export interface SpawnedChild {
  pid?: number;
  unref(): void;
}
/** Starts a process; tests replace it so nothing is really spawned. */
export type Spawner = (cmd: string, args: string[], opts: SpawnOptions) => SpawnedChild;

export const defaultSpawner: Spawner = (cmd, args, opts) => {
  const child = nodeSpawn(cmd, args, opts);
  child.on('error', () => {}); // a failed start shows in the log and in `remy list`
  return child;
};

export const logPath = (home: string, id: string) => join(home, 'logs', `${id}.log`);
const markerPath = (home: string, id: string) => join(home, 'background', `${id}.json`);

export function writeMarker(home: string, id: string, marker: BgMarker): void {
  mkdirSync(join(home, 'background'), { recursive: true });
  writeFileSync(markerPath(home, id), JSON.stringify(marker), { mode: 0o600 });
}

export function readMarker(home: string, id: string): BgMarker | undefined {
  try {
    const m = JSON.parse(readFileSync(markerPath(home, id), 'utf8')) as Partial<BgMarker>;
    return typeof m.pid === 'number' && typeof m.startedAt === 'string'
      ? { pid: m.pid, startedAt: m.startedAt }
      : undefined;
  } catch {
    return undefined;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The flags a worker needs to pick the same model as the command that started it. */
export function forwardedFlags(flags: {
  profile?: string;
  model?: string;
  'base-url'?: string;
}): string[] {
  const out: string[] = [];
  if (flags.profile) out.push('--profile', flags.profile);
  if (flags.model) out.push('--model', flags.model);
  if (flags['base-url']) out.push('--base-url', flags['base-url']);
  return out;
}

export interface EntryPoint {
  execPath: string;
  /** Node flags the current process was started with (for example `--conditions=@remy/source`). */
  execArgv: string[];
  /** The script being run: `release/remy.js` when bundled, `main.ts` from source. */
  script: string;
}

export function currentEntry(): EntryPoint {
  return {
    execPath: process.execPath,
    execArgv: process.execArgv,
    script: process.argv[1] ?? '',
  };
}

/** Starts `remy worker <id>` detached, with its output going to REMY_HOME/logs/<id>.log. */
export function spawnWorker(p: {
  home: string;
  id: string;
  cwd: string;
  env: Record<string, string | undefined>;
  entry: EntryPoint;
  extraArgs?: string[];
  spawner?: Spawner;
}): { pid: number; log: string } {
  mkdirSync(join(p.home, 'logs'), { recursive: true });
  const log = logPath(p.home, p.id);
  const fd = openSync(log, 'a', 0o600);
  try {
    const args = [...p.entry.execArgv, p.entry.script, 'worker', p.id, ...(p.extraArgs ?? [])];
    const child = (p.spawner ?? defaultSpawner)(p.entry.execPath, args, {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...p.env, REMY_HOME: p.home },
      cwd: p.cwd,
    });
    child.unref();
    if (!child.pid) throw new Error('The background worker did not start.');
    writeMarker(p.home, p.id, { pid: child.pid, startedAt: new Date().toISOString() });
    return { pid: child.pid, log };
  } finally {
    closeSync(fd);
  }
}

export type BgState = 'running' | 'waiting for you' | 'paused' | 'stopped' | 'done';

/** What a background task is doing, from the log's status and whether its worker is alive. */
export function bgState(status: TaskStatus, workerAlive: boolean): BgState {
  if (status === 'waiting_approval' || status === 'waiting_user') return 'waiting for you';
  if (status === 'paused') return 'paused';
  if (status === 'running') return workerAlive ? 'running' : 'stopped';
  return 'done';
}

/** The next command for a task in this state. */
export function nextCommand(status: TaskStatus, id: string): string {
  if (status === 'paused') return `remy continue ${id}`;
  if (status === 'waiting_approval' || status === 'waiting_user' || status === 'running')
    return `remy attach ${id}`;
  return `remy show ${id}`;
}

/** The message `remy run --background` and `/bg` print. */
export const startedLine = (id: string) =>
  `Started ${id} in the background. Follow it: remy attach ${id}. Details: remy show ${id}.`;

/** A prompt as a short single-line title for notifications. */
export function notifyTitle(prompt: string): string {
  const flat = prompt
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(flat, 40);
}

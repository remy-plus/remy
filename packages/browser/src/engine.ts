/**
 * An optional browser engine: Lightpanda, a small headless browser that serves CDP. Opt-in with
 * REMY_BROWSER_ENGINE=lightpanda. Remy starts the binary itself, on 127.0.0.1 only and on a free
 * port, connects to it like it connects to a cloud browser, and stops it when the browser closes
 * or sits idle. It looks like a RemoteSessionProvider to the driver, but nothing leaves this
 * computer.
 *
 * This file starts a process, which no other file in this package does. It is on purpose: the
 * binary is the engine, and the spawn is injected so the lifecycle is tested without one.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RemoteSession, RemoteSessionProvider } from './remote.ts';

export const LIGHTPANDA_NOTICE =
  'Pages open in Lightpanda, a small headless engine on this computer. It has no saved logins or cookies, no window, and some pages will not work.';

export const LIGHTPANDA_NO_WINDOW =
  'Lightpanda has no window to show and keeps no saved profile, so Remy cannot sign in to sites with it.';

export function lightpandaPath(home: string = homedir()): string {
  return join(home, '.remy', 'engines', 'lightpanda');
}

export function missingEngineMessage(path: string): string {
  return `REMY_BROWSER_ENGINE=lightpanda needs the Lightpanda program at ${path}. Download the nightly for this computer from https://github.com/lightpanda-io/browser/releases/tag/nightly, save it there and make it runnable (chmod +x).`;
}

export type EngineChoice =
  | { kind: 'chrome' }
  | { kind: 'lightpanda'; path: string }
  /** Asked for, but the program is not there: the caller shows `message` and uses Chrome. */
  | { kind: 'missing'; path: string; message: string }
  | { kind: 'error'; message: string };

/** REMY_BROWSER_ENGINE=lightpanda picks it; unset, empty or `chrome` keeps Chrome. */
export function resolveEngine(
  env: Record<string, string | undefined>,
  opts: { home?: string; exists?: (path: string) => boolean } = {},
): EngineChoice {
  const want = (env.REMY_BROWSER_ENGINE ?? '').trim().toLowerCase();
  if (!want || want === 'chrome') return { kind: 'chrome' };
  if (want !== 'lightpanda')
    return {
      kind: 'error',
      message: `REMY_BROWSER_ENGINE=${want} is not an engine Remy knows. Use lightpanda, or leave it unset for Chrome.`,
    };
  const path = env.REMY_LIGHTPANDA_PATH?.trim() || lightpandaPath(opts.home);
  return (opts.exists ?? existsSync)(path)
    ? { kind: 'lightpanda', path }
    : { kind: 'missing', path, message: missingEngineMessage(path) };
}

/** The part of a child process the lifecycle uses. */
export interface EngineProcess {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  stderr?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
}

export type EngineSpawn = (
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
) => EngineProcess;

export interface LightpandaOptions {
  binary: string;
  /** Let pages open private-network addresses. Default false: the engine blocks them too. */
  allowLocal?: boolean;
  spawn?: EngineSpawn;
  /** A free port on 127.0.0.1. */
  freePort?: () => Promise<number>;
  /** Resolves true once the engine answers on `port`. */
  ready?: (port: number) => Promise<boolean>;
  startTimeoutMs?: number;
  /** How long a stopped process gets before it is killed outright. Default 2 s. */
  killAfterMs?: number;
  /** Environment for the process. Default: this process's. */
  env?: Record<string, string | undefined>;
}

const realSpawn: EngineSpawn = (command, args, env) =>
  nodeSpawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], env: env as NodeJS.ProcessEnv });

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function answers(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** The arguments: loopback only, always. The port is never exposed beyond this computer. */
export function lightpandaArgs(port: number, allowLocal = false): string[] {
  return [
    'serve',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    ...(allowLocal ? [] : ['--block-private-networks']),
  ];
}

export function createLightpandaProvider(opts: LightpandaOptions): RemoteSessionProvider {
  const spawn = opts.spawn ?? realSpawn;
  const freePort = opts.freePort ?? freeLoopbackPort;
  const ready = opts.ready ?? answers;
  const timeout = opts.startTimeoutMs ?? 10_000;
  const killAfter = opts.killAfterMs ?? 2_000;
  const live = new Set<EngineProcess>();
  let hooked = false;

  return {
    id: 'lightpanda',
    label: 'Lightpanda',
    notice: LIGHTPANDA_NOTICE,
    noWindow: LIGHTPANDA_NO_WINDOW,
    async createSession(): Promise<RemoteSession> {
      const port = await freePort();
      const env = { ...(opts.env ?? process.env), LIGHTPANDA_DISABLE_TELEMETRY: 'true' };
      const child = spawn(opts.binary, lightpandaArgs(port, opts.allowLocal), env);
      live.add(child);
      if (!hooked && !opts.spawn) {
        hooked = true;
        // Never leave an engine running after Remy itself is gone.
        process.once('exit', () => {
          for (const c of live) c.kill('SIGKILL');
        });
      }
      let exited = false;
      let spawnError: string | undefined;
      let tail = '';
      child.on('exit', () => {
        exited = true;
        live.delete(child);
      });
      child.on('error', (e) => {
        exited = true;
        spawnError = e.message;
        live.delete(child);
      });
      child.stderr?.on('data', (c) => {
        tail = (tail + String(c)).slice(-400);
      });

      let stopped = false;
      const stop = async (): Promise<void> => {
        if (stopped || exited) return;
        stopped = true;
        child.kill('SIGTERM');
        const t = setTimeout(() => child.kill('SIGKILL'), killAfter);
        t.unref?.();
        const until = Date.now() + killAfter + 500;
        while (!exited && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
        clearTimeout(t);
      };

      const deadline = Date.now() + timeout;
      while (!exited && Date.now() < deadline) {
        if (await ready(port)) {
          return {
            cdpUrl: `ws://127.0.0.1:${port}/`,
            sessionId: String(child.pid ?? port),
            close: stop,
          };
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const why = spawnError
        ? spawnError
        : exited
          ? `it stopped at once${tail ? `: ${tail.trim().split('\n').pop()}` : ''}`
          : 'it did not answer in time';
      await stop();
      throw new Error(`Lightpanda did not start: ${why}`);
    },
  };
}

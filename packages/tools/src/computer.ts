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
  run(
    command: string,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ComputerOutput & { timedOut?: boolean }>;
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
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, signal },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        done({
          exitCode: !e ? 0 : typeof e.code === 'number' ? e.code : 255,
          stdout: String(stdout ?? ''),
          stderr: e?.code === 'ENOENT' ? `${file} was not found` : String(stderr ?? ''),
          // docker exits 0 when it is stopped by the timeout, so the kill itself is what counts.
          ...((e?.killed || (child.killed && !signal?.aborted)) && { timedOut: true }),
        });
      },
    );
    // Nothing is typed into a command, so a program that reads stdin gets end-of-file, not a hang.
    child.stdin?.end();
  });

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export interface SshConfig {
  /** Absent means ssh, so older config files keep working. */
  kind?: 'ssh';
  name: string;
  host: string;
  user: string;
  port?: number;
  /** Path to a private key file. Never the key itself. */
  keyPath?: string;
  /** Seconds ssh waits to connect (default 15). */
  connectTimeoutSec?: number;
  /** A known_hosts file other than the default (passed as UserKnownHostsFile). */
  knownHostsPath?: string;
}

/** A container: one the person already runs (`container`), or one Remy owns from an `image`. */
export interface DockerConfig {
  kind: 'docker';
  name: string;
  container?: string;
  image?: string;
  /** `bridge` (default) or `none` for a container with no network. */
  network?: 'bridge' | 'none';
}

export type ComputerConfig = SshConfig | DockerConfig;

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
  if (
    cfg.knownHostsPath !== undefined &&
    !(cfg.knownHostsPath.length > 0 && !/[\0\r\n]/.test(cfg.knownHostsPath))
  )
    throw new Error(`Invalid knownHostsPath: ${cfg.knownHostsPath}`);
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
        ...(cfg.knownHostsPath ? ['-o', `UserKnownHostsFile=${cfg.knownHostsPath}`] : []),
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

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9./_:@-]*$/;
const CREATE_TIMEOUT_MS = 300_000;
const DAEMON_DOWN =
  /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|error during connect|docker daemon is not running/i;
const GONE = /no such (container|object)/i;

/** A problem with Docker itself (not the command), always before the command ran. */
export class ComputerSetupError extends Error {}

const DOCKER_OFF = 'Docker is not running. Start Docker Desktop or `colima start`, then try again.';
const DOCKER_MISSING =
  'Docker is not installed on this computer. Install Docker Desktop or colima, then try again.';

/** The container's name for a Remy-owned computer. */
export const ownedContainer = (name: string) => `remy-computer-${name}`;

/**
 * A container as a machine. With `container`, commands run in that running container. With only
 * `image`, Remy owns one long-lived container (`remy-computer-<name>`): made on first use, reused
 * after. It never mounts the home folder or the Docker socket and is never privileged.
 */
export function dockerComputer(cfg: DockerConfig, exec: Exec = nodeExec): Computer {
  if (!NAME_RE.test(cfg.name)) throw new Error(`Invalid name: ${cfg.name}`);
  if (cfg.container === undefined && cfg.image === undefined)
    throw new Error(`${cfg.name}: give a container or an image`);
  if (cfg.container !== undefined && cfg.image !== undefined)
    throw new Error(`${cfg.name}: give a container or an image, not both`);
  if (cfg.container !== undefined && !NAME_RE.test(cfg.container))
    throw new Error(`Invalid container: ${cfg.container}`);
  if (cfg.image !== undefined && !IMAGE_RE.test(cfg.image))
    throw new Error(`Invalid image: ${cfg.image}`);
  if (cfg.network !== undefined && cfg.network !== 'bridge' && cfg.network !== 'none')
    throw new Error(`Invalid network: ${String(cfg.network)}`);
  const owned = cfg.container === undefined;
  const container = cfg.container ?? ownedContainer(cfg.name);
  const docker = async (args: string[], timeoutMs: number, signal?: AbortSignal) => {
    const r = await exec('docker', args, { timeoutMs, ...(signal && { signal }) });
    if (r.exitCode !== 0 && !r.timedOut) {
      if (/^docker was not found/.test(r.stderr)) throw new ComputerSetupError(DOCKER_MISSING);
      if (DAEMON_DOWN.test(r.stderr)) throw new ComputerSetupError(DOCKER_OFF);
    }
    return r;
  };
  let ready = false;
  const ensure = async (opts: { timeoutMs: number; signal?: AbortSignal }) => {
    if (ready) return;
    const seen = await docker(
      ['inspect', '--format', '{{.State.Running}}', container],
      opts.timeoutMs,
      opts.signal,
    );
    if (seen.exitCode === 0) {
      if (seen.stdout.trim() !== 'true') {
        if (!owned) throw new ComputerSetupError(`The container ${container} is not running.`);
        const started = await docker(['start', container], opts.timeoutMs, opts.signal);
        if (started.exitCode !== 0)
          throw new ComputerSetupError(`Could not start ${container}: ${started.stderr.trim()}`);
      }
    } else if (!GONE.test(seen.stderr)) {
      throw new ComputerSetupError(`Docker could not check ${container}: ${seen.stderr.trim()}`);
    } else if (!owned) {
      throw new ComputerSetupError(`There is no container named ${container}.`);
    } else {
      const made = await docker(
        [
          'run',
          '-d',
          '--name',
          container,
          '--label',
          `remy.computer=${cfg.name}`,
          '--init',
          '--network',
          cfg.network ?? 'bridge',
          cfg.image as string,
          'sleep',
          'infinity',
        ],
        Math.max(opts.timeoutMs, CREATE_TIMEOUT_MS),
        opts.signal,
      );
      if (made.exitCode !== 0)
        throw new ComputerSetupError(
          `Could not create ${container} from ${cfg.image}: ${made.stderr.trim()}`,
        );
    }
    ready = true;
  };
  return {
    name: cfg.name,
    where: owned
      ? `docker container ${container} (${cfg.image})${cfg.network === 'none' ? ', no network' : ''}`
      : `docker container ${container}`,
    async run(command, opts) {
      await ensure(opts);
      const r = await docker(
        ['exec', '-i', container, 'sh', '-c', command],
        opts.timeoutMs,
        opts.signal,
      );
      // Stopping the docker client does not stop the command inside. A container Remy owns is
      // restarted (its files stay) so nothing keeps running unseen; a container the person runs
      // is left alone.
      if (r.timedOut && owned)
        await docker(['restart', '-t', '1', container], 30_000).catch(() => undefined);
      if (r.exitCode === 125 || (r.exitCode !== 0 && GONE.test(r.stderr))) {
        ready = false;
        throw new ComputerSetupError(`Docker could not run it in ${container}: ${r.stderr.trim()}`);
      }
      return r;
    },
  };
}

/** The provider for one config entry. */
export function computerFromConfig(cfg: ComputerConfig, exec: Exec = nodeExec): Computer {
  return cfg.kind === 'docker' ? dockerComputer(cfg, exec) : sshComputer(cfg, exec);
}

/** One plain line for a config entry, without making a connection. */
export function describeComputer(cfg: ComputerConfig): string {
  if (cfg.kind === 'docker')
    return cfg.container
      ? `docker container ${cfg.container}`
      : `docker container ${ownedContainer(cfg.name)} (${cfg.image})${cfg.network === 'none' ? ', no network' : ''}`;
  return `ssh ${cfg.user}@${cfg.host}${cfg.port ? `:${cfg.port}` : ''}`;
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
      let r: Awaited<ReturnType<Computer['run']>>;
      try {
        r = await c.run(command, { timeoutMs: TIMEOUT_MS, signal: ctx.signal });
      } catch (e) {
        if (e instanceof ComputerSetupError) return fail(e.message);
        throw e;
      }
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

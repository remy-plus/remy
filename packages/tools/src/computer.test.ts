import type { ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import {
  computerFromConfig,
  createComputerTools,
  describeComputer,
  dockerComputer,
  type Exec,
  sshComputer,
} from './computer.ts';
import { createScopedFs } from './scoped-fs.ts';

const ctx = (): ToolContext => ({
  taskId: 't',
  callId: 'c',
  idempotencyKey: 't:c',
  signal: new AbortController().signal,
  fs: createScopedFs('/tmp'),
  net: { get: () => Promise.reject(new Error('no net')) },
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
});

const cfg = { name: 'home', host: '10.0.0.5', user: 'remy' };

describe('sshComputer', () => {
  it('passes the command after "--" with batch mode and host key checking on', async () => {
    let seen: string[] = [];
    const exec: Exec = async (_f, args) => {
      seen = args;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    };
    const c = sshComputer({ ...cfg, port: 2222, keyPath: '/k/id' }, exec);
    await c.run('uptime', { timeoutMs: 1000 });
    expect(seen).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=15',
      '-p',
      '2222',
      '-i',
      '/k/id',
      '-o',
      'IdentitiesOnly=yes',
      'remy@10.0.0.5',
      '--',
      'uptime',
    ]);
    expect(c.where).toBe('ssh remy@10.0.0.5:2222');
  });

  it('uses the connect timeout it is given', async () => {
    let seen: string[] = [];
    const exec: Exec = async (_f, args) => {
      seen = args;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await sshComputer({ ...cfg, connectTimeoutSec: 10 }, exec).run('true', { timeoutMs: 1000 });
    expect(seen).toContain('ConnectTimeout=10');
  });

  it.each([
    { connectTimeoutSec: 0 },
    { connectTimeoutSec: 1.5 },
    { connectTimeoutSec: 9999 },
    { host: '-oProxyCommand=evil' },
    { user: '-x' },
    { host: 'a b' },
    { name: 'x;y' },
    { port: 0 },
    { keyPath: '-F/etc/x' },
  ])('refuses unsafe settings %o', (bad) => {
    expect(() => sshComputer({ ...cfg, ...bad })).toThrow();
  });
});

describe('computer_run', () => {
  const fake = (out = { exitCode: 3, stdout: 'hi', stderr: 'bad' } as object) => ({
    name: 'home',
    where: 'ssh remy@10.0.0.5',
    run: async () => out as never,
  });
  const [tool] = createComputerTools([fake()]);
  if (!tool) throw new Error('no tool');

  it('always asks and is never retried', () => {
    expect(tool.risk).toBe('irreversible');
    expect(tool.effect).toBe('unsafe_to_retry');
    expect(tool.outputTrust).toBe('untrusted');
  });

  it('shows the machine on the approval card', () => {
    expect(tool.preview?.({ computer: 'home', command: 'ls' })).toBe(
      'Run on home (ssh remy@10.0.0.5): ls',
    );
  });

  it('returns the exit code and output as untrusted text', async () => {
    const r = await tool.execute({ computer: 'home', command: 'ls' }, ctx());
    expect(r).toEqual({
      ok: true,
      content: 'exit code: 3\nstdout:\nhi\nstderr:\nbad',
      trust: 'untrusted',
    });
  });

  it('names the machines when the name is wrong, and reports a timeout as after effect', async () => {
    const bad = await tool.execute({ computer: 'nope', command: 'ls' }, ctx());
    expect(bad).toMatchObject({ ok: false, phase: 'before_effect' });
    const [slow] = createComputerTools([
      fake({ exitCode: 255, stdout: '', stderr: '', timedOut: true }),
    ]);
    const r = await slow?.execute({ computer: 'home', command: 'sleep 99' }, ctx());
    expect(r).toMatchObject({ ok: false, phase: 'after_effect' });
  });
});

describe('sshComputer known hosts file', () => {
  it('passes a known_hosts file of its own and refuses a broken one', async () => {
    let seen: string[] = [];
    const exec: Exec = async (_f, args) => {
      seen = args;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await sshComputer({ ...cfg, knownHostsPath: '/t/known hosts' }, exec).run('true', {
      timeoutMs: 1000,
    });
    expect(seen).toContain('UserKnownHostsFile=/t/known hosts');
    expect(() => sshComputer({ ...cfg, knownHostsPath: '' })).toThrow();
    expect(() => sshComputer({ ...cfg, knownHostsPath: '/a\n/b' })).toThrow();
  });
});

type Call = { file: string; args: string[]; timeoutMs: number };
type Out = { exitCode: number; stdout?: string; stderr?: string; timedOut?: boolean };
/** A fake docker: answers each call from `script(args)` and records every call. */
function fakeDocker(script: (args: string[]) => Out) {
  const calls: Call[] = [];
  const exec: Exec = async (file, args, o) => {
    calls.push({ file, args, timeoutMs: o.timeoutMs });
    const r = script(args);
    return {
      exitCode: r.exitCode,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      ...(r.timedOut && { timedOut: true }),
    };
  };
  return { exec, calls, verbs: () => calls.map((c) => c.args[0]) };
}
const NO_SUCH = { exitCode: 1, stderr: 'Error: No such object: remy-computer-box' };
const run = { timeoutMs: 1000 };
const owned = { kind: 'docker', name: 'box', image: 'debian:stable-slim' } as const;
const mine = { kind: 'docker', name: 'web', container: 'my-web' } as const;

describe('dockerComputer', () => {
  it('creates the container on first use, then reuses it', async () => {
    let made = false;
    const d = fakeDocker((a) => {
      if (a[0] === 'inspect') return made ? { exitCode: 0, stdout: 'true\n' } : NO_SUCH;
      if (a[0] === 'run') {
        made = true;
        return { exitCode: 0, stdout: 'abc\n' };
      }
      return { exitCode: 0, stdout: 'Linux\n' };
    });
    const c = dockerComputer(owned, d.exec);
    expect(c.where).toBe('docker container remy-computer-box (debian:stable-slim)');
    expect((await c.run('uname', run)).stdout).toBe('Linux\n');
    await c.run('uname', run);
    expect(d.verbs()).toEqual(['inspect', 'run', 'exec', 'exec']);
    expect(d.calls[1]?.args).toEqual([
      'run',
      '-d',
      '--name',
      'remy-computer-box',
      '--label',
      'remy.computer=box',
      '--init',
      '--network',
      'bridge',
      'debian:stable-slim',
      'sleep',
      'infinity',
    ]);
    expect(d.calls[1]?.timeoutMs).toBeGreaterThan(100_000);
    expect(d.calls[2]?.args).toEqual(['exec', '-i', 'remy-computer-box', 'sh', '-c', 'uname']);
  });

  it('never mounts, shares the socket or runs privileged, and can cut the network', async () => {
    const d = fakeDocker((a) => (a[0] === 'inspect' ? NO_SUCH : { exitCode: 0 }));
    const c = dockerComputer({ ...owned, network: 'none' }, d.exec);
    await c.run('true', run);
    const made = d.calls[1]?.args.join(' ') ?? '';
    expect(made).toContain('--network none');
    expect(made).not.toMatch(/-v |--volume|--mount|privileged|docker\.sock|--pid|--cap-add/);
    expect(c.where).toContain('no network');
  });

  it('starts a stopped container it owns instead of making another', async () => {
    const d = fakeDocker((a) =>
      a[0] === 'inspect' ? { exitCode: 0, stdout: 'false\n' } : { exitCode: 0 },
    );
    await dockerComputer(owned, d.exec).run('true', run);
    expect(d.verbs()).toEqual(['inspect', 'start', 'exec']);
  });

  it('runs in a container that already runs, and never creates one', async () => {
    const d = fakeDocker((a) =>
      a[0] === 'inspect' ? { exitCode: 0, stdout: 'true\n' } : { exitCode: 0, stdout: 'x' },
    );
    const c = dockerComputer(mine, d.exec);
    expect(c.where).toBe('docker container my-web');
    await c.run('ls "a b"; echo $HOME', run);
    expect(d.calls[1]?.args).toEqual(['exec', '-i', 'my-web', 'sh', '-c', 'ls "a b"; echo $HOME']);
    const gone = fakeDocker(() => ({ exitCode: 1, stderr: 'Error: No such object: my-web' }));
    await expect(dockerComputer(mine, gone.exec).run('x', run)).rejects.toThrow(
      'There is no container named my-web.',
    );
    expect(gone.verbs()).toEqual(['inspect']);
    const stopped = fakeDocker(() => ({ exitCode: 0, stdout: 'false\n' }));
    await expect(dockerComputer(mine, stopped.exec).run('x', run)).rejects.toThrow(
      'is not running',
    );
    expect(stopped.verbs()).toEqual(['inspect']);
  });

  it('says so when Docker is not installed or not running', async () => {
    const missing = fakeDocker(() => ({ exitCode: 255, stderr: 'docker was not found' }));
    await expect(dockerComputer(owned, missing.exec).run('x', run)).rejects.toThrow(
      'Docker is not installed',
    );
    for (const stderr of [
      'Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?',
      'failed to connect to the docker API at unix:///x.sock; check if the path is correct and if the daemon is running',
      'error during connect: Get "http://docker.sock/v1.47/containers": dial unix',
    ]) {
      const off = fakeDocker(() => ({ exitCode: 1, stderr }));
      await expect(dockerComputer(owned, off.exec).run('x', run)).rejects.toThrow(
        'Docker is not running. Start Docker Desktop or `colima start`, then try again.',
      );
      expect(off.verbs()).toEqual(['inspect']);
    }
    const down = fakeDocker(() => ({ exitCode: 1, stderr: 'Cannot connect to the Docker daemon' }));
    const [tool] = createComputerTools([dockerComputer(owned, down.exec)]);
    expect(await tool?.execute({ computer: 'box', command: 'ls' }, ctx())).toMatchObject({
      ok: false,
      phase: 'before_effect',
      error: expect.stringContaining('Docker is not running'),
    });
  });

  it('reports a failed create, a failed start and a failed check', async () => {
    const bad = fakeDocker((a) =>
      a[0] === 'inspect' ? NO_SUCH : { exitCode: 125, stderr: 'pull access denied' },
    );
    await expect(dockerComputer(owned, bad.exec).run('x', run)).rejects.toThrow(
      'Could not create remy-computer-box from debian:stable-slim: pull access denied',
    );
    const nostart = fakeDocker((a) =>
      a[0] === 'inspect' ? { exitCode: 0, stdout: 'false' } : { exitCode: 1, stderr: 'boom' },
    );
    await expect(dockerComputer(owned, nostart.exec).run('x', run)).rejects.toThrow(
      'Could not start',
    );
    const odd = fakeDocker(() => ({ exitCode: 1, stderr: 'permission denied' }));
    await expect(dockerComputer(owned, odd.exec).run('x', run)).rejects.toThrow('could not check');
  });

  it("passes the command's own exit code and output through, and a timeout", async () => {
    const d = fakeDocker((a) =>
      a[0] === 'inspect'
        ? { exitCode: 0, stdout: 'true' }
        : { exitCode: 7, stdout: 'o', stderr: 'e' },
    );
    expect(await dockerComputer(owned, d.exec).run('exit 7', run)).toEqual({
      exitCode: 7,
      stdout: 'o',
      stderr: 'e',
    });
    const slow = fakeDocker((a) =>
      a[0] === 'inspect' ? { exitCode: 0, stdout: 'true' } : { exitCode: 255, timedOut: true },
    );
    const [tool] = createComputerTools([dockerComputer(owned, slow.exec)]);
    expect(await tool?.execute({ computer: 'box', command: 'sleep 99' }, ctx())).toMatchObject({
      ok: false,
      phase: 'after_effect',
    });
  });

  it('restarts a container it owns after a timeout, but not one the person runs', async () => {
    const script = (a: string[]): Out =>
      a[0] === 'inspect'
        ? { exitCode: 0, stdout: 'true' }
        : a[0] === 'exec'
          ? { exitCode: 0, timedOut: true }
          : { exitCode: 0 };
    const mineOwn = fakeDocker(script);
    await dockerComputer(owned, mineOwn.exec).run('sleep 99', run);
    expect(mineOwn.calls.at(-1)?.args).toEqual(['restart', '-t', '1', 'remy-computer-box']);
    const theirs = fakeDocker(script);
    await dockerComputer(mine, theirs.exec).run('sleep 99', run);
    expect(theirs.verbs()).toEqual(['inspect', 'exec']);
  });

  it('passes through a command of its own that exits 125 or prints "no such object"', async () => {
    const d = fakeDocker((a) =>
      a[0] === 'inspect'
        ? { exitCode: 0, stdout: 'true' }
        : { exitCode: 125, stderr: 'no such object' },
    );
    const r = await dockerComputer(owned, d.exec).run('exit 125', run);
    expect(r.exitCode).toBe(125);
    expect(r.stderr).toBe('no such object');
  });

  it('checks again when the container disappears between commands', async () => {
    let alive = true;
    const d = fakeDocker((a) => {
      if (a[0] === 'inspect') return alive ? { exitCode: 0, stdout: 'true' } : NO_SUCH;
      if (a[0] === 'exec' && !alive)
        return {
          exitCode: 1,
          stderr: 'Error response from daemon: No such container: remy-computer-box',
        };
      return { exitCode: 0 };
    });
    const c = dockerComputer(owned, d.exec);
    await c.run('x', run);
    alive = false;
    await expect(c.run('x', run)).rejects.toThrow('Docker could not run it');
    alive = true;
    await c.run('x', run);
    expect(d.verbs()).toEqual(['inspect', 'exec', 'exec', 'inspect', 'exec']);
  });

  it.each([
    { name: '-x' },
    { name: 'a b' },
    { image: '-v/:/host' },
    { image: 'Debian' },
    { image: 'a b' },
    { image: undefined },
    { container: 'x' },
    { network: 'host' as never },
  ])('refuses unsafe or incomplete settings %o', (bad) => {
    expect(() => dockerComputer({ ...owned, ...bad })).toThrow();
  });

  it('refuses a container name that starts with a dash', () => {
    expect(() => dockerComputer({ kind: 'docker', name: 'w', container: '--privileged' })).toThrow(
      'Invalid container',
    );
  });

  it('computerFromConfig and describeComputer pick by kind', () => {
    expect(computerFromConfig(owned).where).toContain('docker container');
    expect(computerFromConfig(cfg).where).toBe('ssh remy@10.0.0.5');
    expect(computerFromConfig({ kind: 'ssh', ...cfg }).where).toBe('ssh remy@10.0.0.5');
    expect(describeComputer(owned)).toBe('docker container remy-computer-box (debian:stable-slim)');
    expect(describeComputer(mine)).toBe('docker container my-web');
    expect(describeComputer({ ...cfg, port: 22 })).toBe('ssh remy@10.0.0.5:22');
  });
});

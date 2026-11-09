import type { ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { createComputerTools, type Exec, sshComputer } from './computer.ts';
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

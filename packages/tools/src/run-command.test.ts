// Spec for run_command (V1 work package 1).
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@remy/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRunCommand, createScopedFs, runCommand } from './index.ts';

let root: string;
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'remy-cmd-'));
  root = join(base, 'ws');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'alpha');
  symlinkSync(base, join(root, 'link'));
});

const ctx = (): ToolContext => ({
  taskId: 't',
  callId: 'c',
  idempotencyKey: 't:c',
  signal: new AbortController().signal,
  fs: createScopedFs(root),
  net: { get: () => Promise.reject(new Error('no net')) },
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
});

const run = (program: string, args: string[] = [], cwd?: string) =>
  runCommand.execute(runCommand.args.parse({ program, args, cwd }), ctx());

describe('run_command', () => {
  it('is irreversible, unsafe to retry and untrusted', () => {
    expect(runCommand.risk).toBe('irreversible');
    expect(runCommand.effect).toBe('unsafe_to_retry');
    expect(runCommand.outputTrust).toBe('untrusted');
  });

  it('runs an allowed program in the workspace and returns exit code and output', async () => {
    const r = await run('cat', ['a.txt']);
    expect(r).toEqual({
      ok: true,
      content: 'exit code: 0\nstdout:\nalpha\nstderr:\n',
      trust: 'untrusted',
    });
    const sub = await run('ls', ['..'], 'sub');
    expect(sub.ok && sub.content).toContain('a.txt');
  });

  it('reports a failing exit code as a result, not an error', async () => {
    const r = await run('cat', ['missing.txt']);
    expect(r.ok && r.content).toMatch(/^exit code: 1\n/);
  });

  it('refuses programs that are not allowed, including paths', async () => {
    expect((await run('rm', ['a.txt'])).ok).toBe(false);
    expect((await run('/bin/ls')).ok).toBe(false);
    expect((await run('sh', ['-c', 'ls'])).ok).toBe(false);
  });

  it('can be given a different allowlist', async () => {
    const only = createRunCommand({ allow: ['ls'] });
    expect(
      (await only.execute(only.args.parse({ program: 'cat', args: ['a.txt'] }), ctx())).ok,
    ).toBe(false);
    expect((await only.execute(only.args.parse({ program: 'ls' }), ctx())).ok).toBe(true);
  });

  it('refuses arguments and folders outside the workspace', async () => {
    expect((await run('cat', ['/etc/passwd'])).ok).toBe(false);
    expect((await run('cat', ['../secret.txt'])).ok).toBe(false);
    expect((await run('cat', ['sub/../../x'])).ok).toBe(false);
    expect((await run('grep', ['--file=/etc/passwd', 'a.txt'])).ok).toBe(false);
    expect((await run('ls', [], '..')).ok).toBe(false);
    expect((await run('ls', [], '/')).ok).toBe(false);
    expect((await run('ls', [], 'link')).ok).toBe(false);
    expect((await run('cat', [join(root, 'a.txt')])).ok).toBe(true); // absolute but inside
  });

  it('does not use a shell', async () => {
    const r = await run('cat', ['a.txt; echo hi']);
    expect(r.ok && r.content).toMatch(/^exit code: 1\n/);
  });

  it('reduces the environment to PATH, HOME and LANG', async () => {
    process.env.REMY_TEST_SECRET = 'leak';
    try {
      const r = await run('node', [
        '-e',
        'console.log(Object.keys(process.env).filter((k) => !k.startsWith("__")).sort().join())',
      ]);
      expect(r.ok && r.content).not.toContain('REMY_TEST_SECRET');
      expect(r.ok && r.content).toMatch(/stdout:\n(HOME,)?(LANG,)?PATH\n/);
    } finally {
      delete process.env.REMY_TEST_SECRET;
    }
  });

  it('truncates large output with a note', async () => {
    const r = await run('node', ['-e', 'process.stdout.write("x".repeat(200000))']);
    expect(r.ok && r.content).toContain('[output truncated at 64KB]');
    expect(r.ok && r.content.length).toBeLessThan(70_000);
  });
});

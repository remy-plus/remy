// Spec for ScopedFs and the file tools (PLAN.md step 4).
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@remy/core';
import { ToolRegistry } from '@remy/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createScopedFs, finish, listFiles, readFile, ScopeError, writeFile } from './index.ts';

let root: string;
let outside: string;
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'remy-fs-'));
  root = join(base, 'ws');
  outside = join(base, 'secret.txt');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'alpha');
  writeFileSync(outside, 'top secret');
});

const ctx = (fs = createScopedFs(root)): ToolContext => ({
  taskId: 't',
  callId: 'c',
  idempotencyKey: 't:c',
  signal: new AbortController().signal,
  fs,
  net: { get: () => Promise.reject(new Error('no net')) },
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
});

describe('ScopedFs', () => {
  it('reads, writes and lists inside the root', async () => {
    const fs = createScopedFs(root);
    expect(await fs.readText('a.txt')).toBe('alpha');
    await fs.writeText('sub/new/b.txt', 'beta'); // creates parent dirs
    expect(readFileSync(join(root, 'sub/new/b.txt'), 'utf8')).toBe('beta');
    expect(await fs.list('.')).toEqual([
      { name: 'a.txt', dir: false },
      { name: 'sub', dir: true },
    ]);
  });

  it.each(['../secret.txt', 'sub/../../secret.txt', '/etc/passwd', ''])(
    'rejects escape via %j',
    async (p) => {
      const fs = createScopedFs(root);
      await expect(fs.readText(p)).rejects.toBeInstanceOf(ScopeError);
      await expect(fs.writeText(p, 'x')).rejects.toBeInstanceOf(ScopeError);
    },
  );

  it('rejects absolute paths even inside the root', async () => {
    await expect(createScopedFs(root).readText(join(root, 'a.txt'))).rejects.toBeInstanceOf(
      ScopeError,
    );
  });

  it('rejects symlink escapes for reads and writes', async () => {
    symlinkSync(outside, join(root, 'link.txt'));
    symlinkSync(join(outside, '..'), join(root, 'linkdir'));
    const fs = createScopedFs(root);
    await expect(fs.readText('link.txt')).rejects.toBeInstanceOf(ScopeError);
    await expect(fs.writeText('link.txt', 'pwned')).rejects.toBeInstanceOf(ScopeError);
    await expect(fs.writeText('linkdir/x.txt', 'pwned')).rejects.toBeInstanceOf(ScopeError);
    await expect(fs.list('linkdir')).rejects.toBeInstanceOf(ScopeError);
    expect(readFileSync(outside, 'utf8')).toBe('top secret');
  });

  it('enforces a size limit on reads and writes', async () => {
    const fs = createScopedFs(root, { maxBytes: 4 });
    await expect(fs.readText('a.txt')).rejects.toThrow(/too large/i);
    await expect(fs.writeText('b.txt', '12345')).rejects.toThrow(/too large/i);
  });
});

describe('file tools', () => {
  it('declare the risk and effect from the plan', () => {
    const r = new ToolRegistry([readFile, writeFile, listFiles, finish]);
    expect(r.list().map((t) => [t.name, t.risk, t.effect, t.outputTrust])).toEqual([
      ['read_file', 'read', 'none', 'trusted'],
      ['write_file', 'write', 'idempotent', 'trusted'],
      ['list_files', 'read', 'none', 'trusted'],
      ['finish', 'read', 'none', 'trusted'],
    ]);
  });

  it('read_file / write_file / list_files go through ctx.fs', async () => {
    const c = ctx();
    expect(await readFile.execute({ path: 'a.txt' }, c)).toEqual({
      ok: true,
      content: 'alpha',
      trust: 'trusted',
    });
    expect((await writeFile.execute({ path: 'b.txt', content: 'beta' }, c)).ok).toBe(true);
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('beta');
    const listed = await listFiles.execute({ path: '.' }, c);
    expect(listed.ok && listed.content).toContain('b.txt');
    expect(writeFile.preview({ path: 'b.txt', content: 'beta' })).toMatch(/b\.txt/);
  });

  it('turns scope errors into non-retryable tool errors', async () => {
    const r = await readFile.execute({ path: '../secret.txt' }, ctx());
    expect(r).toMatchObject({ ok: false, retryable: false, phase: 'before_effect' });
  });

  it('missing files are a plain error, not a crash', async () => {
    const r = await readFile.execute({ path: 'nope.txt' }, ctx());
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it('finish returns the answer', async () => {
    expect(await finish.execute({ answer: '42' }, ctx())).toEqual({
      ok: true,
      content: '42',
      trust: 'trusted',
    });
  });
});

// Spec for edit_file, move_file, delete_file and make_dir (V1 work package 1).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ToolContext } from '@remy/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createScopedFs, deleteFile, editFile, makeDir, moveFile } from './index.ts';

let root: string;
let outside: string;
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'remy-edit-'));
  root = join(base, 'ws');
  outside = join(base, 'secret.txt');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'alpha');
  writeFileSync(outside, 'top secret');
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

describe('edit_file', () => {
  it('replaces one match, refuses missing or ambiguous ones', async () => {
    writeFileSync(join(root, 'e.txt'), 'one two two');
    const c = ctx();
    const miss = await editFile.execute({ path: 'e.txt', old: 'zzz', new: 'y', all: false }, c);
    expect(miss.ok).toBe(false);
    const many = await editFile.execute({ path: 'e.txt', old: 'two', new: '2', all: false }, c);
    expect(many.ok).toBe(false);
    const one = await editFile.execute({ path: 'e.txt', old: 'one', new: '1', all: false }, c);
    expect(one.ok && one.content).toContain('1 two two');
    expect(readFileSync(join(root, 'e.txt'), 'utf8')).toBe('1 two two');
    await editFile.execute({ path: 'e.txt', old: 'two', new: '2', all: true }, c);
    expect(readFileSync(join(root, 'e.txt'), 'utf8')).toBe('1 2 2');
  });
});

describe('move_file', () => {
  it('moves, refuses to overwrite, and reconciles', async () => {
    const c = ctx();
    expect((await moveFile.execute({ from: 'a.txt', to: 'x/b.txt' }, c)).ok).toBe(true);
    expect(readFileSync(join(root, 'x/b.txt'), 'utf8')).toBe('alpha');
    expect(await moveFile.reconcile?.({ from: 'a.txt', to: 'x/b.txt' }, c)).toMatchObject({
      done: true,
    });
    expect(await moveFile.reconcile?.({ from: 'nope', to: 'zip' }, c)).toEqual({ done: false });
    writeFileSync(join(root, 'a.txt'), 'again');
    expect((await moveFile.execute({ from: 'a.txt', to: 'x/b.txt' }, c)).ok).toBe(false);
  });
});

describe('delete_file and make_dir', () => {
  it('delete_file deletes files only and is irreversible', async () => {
    const c = ctx();
    expect(deleteFile.risk).toBe('irreversible');
    expect((await deleteFile.execute({ path: 'a.txt' }, c)).ok).toBe(true);
    expect(existsSync(join(root, 'a.txt'))).toBe(false);
    expect((await deleteFile.execute({ path: 'a.txt' }, c)).ok).toBe(true);
    expect((await deleteFile.execute({ path: 'sub' }, c)).ok).toBe(false);
  });

  it('make_dir creates nested folders', async () => {
    expect((await makeDir.execute({ path: 'p/q/r' }, ctx())).ok).toBe(true);
    expect(existsSync(join(root, 'p/q/r'))).toBe(true);
  });
});

describe('scope', () => {
  it('refuses paths outside the root, including through symlinks', async () => {
    symlinkSync(dirname(outside), join(root, 'link'));
    const c = ctx();
    const edit = { path: 'link/secret.txt', old: 'top', new: 'x', all: false };
    expect((await moveFile.execute({ from: 'a.txt', to: '../a.txt' }, c)).ok).toBe(false);
    expect((await moveFile.execute({ from: 'a.txt', to: 'link/a.txt' }, c)).ok).toBe(false);
    expect((await moveFile.execute({ from: 'link/secret.txt', to: 'm.txt' }, c)).ok).toBe(false);
    expect((await deleteFile.execute({ path: 'link/secret.txt' }, c)).ok).toBe(false);
    expect((await makeDir.execute({ path: 'link/new' }, c)).ok).toBe(false);
    expect((await editFile.execute(edit, c)).ok).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('top secret');
  });
});

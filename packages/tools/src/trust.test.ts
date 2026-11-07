import { describe, expect, it } from 'vitest';
import { deleteFile, editFile, makeDir, moveFile } from './edit-tools.ts';
import { writeFile } from './file-tools.ts';
import { runCommand } from './run-command.ts';

describe('which tools opt in to a trust level', () => {
  it('file work in the workspace is steady', () => {
    for (const t of [writeFile, editFile, moveFile, makeDir]) expect(t.trustFrom).toBe('steady');
  });
  it('deleting and running commands never opt in', () => {
    expect(deleteFile.trustFrom).toBeUndefined();
    expect(runCommand.trustFrom).toBeUndefined();
  });
});

describe('write_file under a trust level', () => {
  const setup = async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createScopedFs } = await import('./scoped-fs.ts');
    const fs = createScopedFs(mkdtempSync(join(tmpdir(), 'wf-')));
    const run = (path: string, content: string, clearedBy?: 'trust') =>
      writeFile.execute({ path, content }, { fs, ...(clearedBy && { clearedBy }) } as never);
    return { fs, run };
  };

  it('keeps the old version, then -2, and says where', async () => {
    const { fs, run } = await setup();
    await fs.writeText('a.md', 'one');
    const r1 = await run('a.md', 'two', 'trust');
    expect(r1.ok && r1.content).toContain('a.md.before-remy');
    expect(await fs.readText('a.md.before-remy')).toBe('one');
    await run('a.md', 'three', 'trust');
    expect(await fs.readText('a.md.before-remy-2')).toBe('two');
    expect(await fs.readText('a.md')).toBe('three');
  });
  it('a retry after the write made no second backup', async () => {
    const { fs, run } = await setup();
    await fs.writeText('a.md', 'one');
    await run('a.md', 'two', 'trust');
    await run('a.md', 'two', 'trust');
    expect(await fs.exists('a.md.before-remy-2')).toBe(false);
  });
  it('a retry after the copy but before the write reuses the copy', async () => {
    const { fs, run } = await setup();
    await fs.writeText('a.md', 'one');
    await fs.writeText('a.md.before-remy', 'one');
    await run('a.md', 'two', 'trust');
    expect(await fs.exists('a.md.before-remy-2')).toBe(false);
    expect(await fs.readText('a.md')).toBe('two');
  });
  it('makes no copy when the user approved it or the file is new', async () => {
    const { fs, run } = await setup();
    await fs.writeText('a.md', 'one');
    await run('a.md', 'two');
    await run('b.md', 'new', 'trust');
    expect(await fs.exists('a.md.before-remy')).toBe(false);
    expect(await fs.exists('b.md.before-remy')).toBe(false);
  });
});

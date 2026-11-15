import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const header = (await import(
  pathToFileURL(join(import.meta.dirname, '..', 'scripts', 'bin-header.mjs')).href
)) as { binSource(main?: string): string };

describe('the published bin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remy-bin-'));
  const run = (main: string) => {
    writeFileSync(join(dir, 'main.mjs'), main);
    writeFileSync(join(dir, 'remy.mjs'), header.binSource('./main.mjs'));
    return spawnSync(process.execPath, [join(dir, 'remy.mjs')], {
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_ENV')),
    });
  };

  it('loads node:sqlite without printing the experimental warning, and still sets NODE_ENV', () => {
    const r = run(
      "import 'node:sqlite'; console.log('env=' + process.env.NODE_ENV); await new Promise((r) => setTimeout(r, 50));",
    );
    expect(r.stdout.trim()).toBe('env=production');
    expect(r.stderr).not.toMatch(/SQLite/);
  });

  it('still shows every other warning', () => {
    const r = run(
      "process.emitWarning('Something else', 'ExperimentalWarning'); process.emitWarning('legacy thing', 'DeprecationWarning'); await new Promise((r) => setTimeout(r, 50));",
    );
    expect(r.stderr).toMatch(/Something else/);
    expect(r.stderr).toMatch(/legacy thing/);
  });
});

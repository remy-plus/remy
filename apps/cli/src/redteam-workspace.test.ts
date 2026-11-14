// Red team (2026-11-13): picking Remy's own data folder as "the folder Remy may use", with another
// letter case. On macOS the disk ignores case, so `Remy-Data` and `remy-data` are the same folder.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from './serve-settings.ts';

let base: string;
let userHome: string;
let home: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'remy-rt-ws-')));
  userHome = join(base, 'me');
  home = join(userHome, 'Documents', 'Remy-Data'); // Remy's data kept in a plain folder
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const caseInsensitive = (() => {
  try {
    const probe = mkdtempSync(join(tmpdir(), 'remy-rt-case-'));
    mkdirSync(join(probe, 'Ab'));
    try {
      mkdirSync(join(probe, 'aB'));
      rmSync(probe, { recursive: true, force: true });
      return false;
    } catch {
      rmSync(probe, { recursive: true, force: true });
      return true;
    }
  } catch {
    return false;
  }
})();

describe('red team: the folder Remy may use', () => {
  it.runIf(caseInsensitive)("refuses Remy's data folder written with other letter case", () => {
    for (const typed of [
      join(userHome, 'documents', 'remy-data'),
      join(userHome, 'DOCUMENTS', 'REMY-DATA'),
      join(userHome, 'Documents'), // holds the data folder
    ]) {
      expect(() => checkWorkspace(typed, home, userHome), typed).toThrow(/own data/);
    }
  });

  it('refuses the data folder itself, a parent, and a link to it', () => {
    expect(() => checkWorkspace(home, home, userHome)).toThrow(/own data/);
    expect(() => checkWorkspace(join(userHome, 'Documents'), home, userHome)).toThrow(/own data/);
  });
});

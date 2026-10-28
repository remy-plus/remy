import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from './prefs.ts';

const home = () => mkdtempSync(join(tmpdir(), 'remy-prefs-'));

describe('preferences', () => {
  it('starts empty and merges saves', () => {
    const h = home();
    expect(loadPrefs(h)).toEqual({});
    expect(savePrefs(h, { theme: 'light' })).toBe(true);
    expect(savePrefs(h, { minimal: true })).toBe(true);
    expect(loadPrefs(h)).toEqual({ theme: 'light', minimal: true });
  });
  it('remembers that onboarding is done', () => {
    const h = home();
    expect(loadPrefs(h).onboarded).toBeUndefined();
    savePrefs(h, { onboarded: true });
    savePrefs(h, { theme: 'dark' });
    expect(loadPrefs(h)).toEqual({ onboarded: true, theme: 'dark' });
  });
  it('ignores a damaged file and unknown values', () => {
    const h = home();
    writeFileSync(join(h, 'preferences.json'), '{nope');
    expect(loadPrefs(h)).toEqual({});
    writeFileSync(join(h, 'preferences.json'), '{"theme":"pink","minimal":"yes"}');
    expect(loadPrefs(h)).toEqual({});
  });
});

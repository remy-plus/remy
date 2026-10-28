// Settings the user changes inside the chat (/theme, /minimal). They live in REMY_HOME/preferences.json,
// apart from remy.config.json, which the user edits by hand.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ThemeChoice = 'auto' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

export interface Prefs {
  theme?: ThemeChoice;
  /** The minimal screen is the default on start. */
  minimal?: boolean;
}

export const isThemeChoice = (v: unknown): v is ThemeChoice =>
  typeof v === 'string' && (THEME_CHOICES as readonly string[]).includes(v);

const fileOf = (home: string) => join(home, 'preferences.json');

/** Reads the saved preferences; a missing or damaged file means defaults. */
export function loadPrefs(home: string): Prefs {
  const path = fileOf(home);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      ...(isThemeChoice(raw.theme) && { theme: raw.theme }),
      ...(typeof raw.minimal === 'boolean' && { minimal: raw.minimal }),
    };
  } catch {
    return {};
  }
}

/** Merges `patch` into the saved preferences. Returns false when the file cannot be written. */
export function savePrefs(home: string, patch: Prefs): boolean {
  try {
    const path = fileOf(home);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ ...loadPrefs(home), ...patch }, null, 2)}\n`);
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

// The local profile from onboarding: a name and what the user mostly wants help with. It lives in
// REMY_HOME/profile.json (owner-only), is never logged, and leaves the computer only as one line of
// context to the user's own model, and only when they agreed.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { goalById, goalPhrase, normalizeGoals } from './goals.ts';

export interface Profile {
  name: string;
  /** Known goal ids, or the user's own words. */
  goals: string[];
  /** ISO time the profile was first made. */
  createdAt: string;
  /** Send the one-line context to the model. Default on; asked during onboarding. */
  personalise: boolean;
}

export const MAX_NAME_CHARS = 40;

/** A name as it is stored: one line of letters, numbers, spaces and . ' - only. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\p{N} .'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

const fileOf = (home: string) => join(home, 'profile.json');

/** The saved profile; a missing or damaged file means none. Fields are cleaned on the way in. */
export function loadProfile(home: string): Profile | undefined {
  const path = fileOf(home);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return undefined;
    const name = typeof raw.name === 'string' ? cleanName(raw.name) : '';
    const goals = Array.isArray(raw.goals)
      ? normalizeGoals(raw.goals.filter((g): g is string => typeof g === 'string'))
      : [];
    const created = typeof raw.createdAt === 'string' ? raw.createdAt : '';
    return {
      name,
      goals,
      createdAt: Number.isNaN(Date.parse(created)) ? new Date(0).toISOString() : created,
      personalise: raw.personalise !== false,
    };
  } catch {
    return undefined;
  }
}

/** Writes the profile with owner-only permissions. False when it could not be written. */
export function saveProfile(home: string, profile: Profile): boolean {
  try {
    const path = fileOf(home);
    mkdirSync(home, { recursive: true });
    const clean: Profile = {
      name: cleanName(profile.name),
      goals: normalizeGoals(profile.goals),
      createdAt: profile.createdAt,
      personalise: profile.personalise,
    };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** Removes the profile file. True when nothing is left. */
export function deleteProfile(home: string): boolean {
  try {
    rmSync(fileOf(home), { force: true });
    return true;
  } catch {
    return false;
  }
}

const list = (items: string[]) =>
  items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * The one line sent to the model, or undefined when the user did not agree or there is nothing to
 * say. Typed goals are quoted so they read as the user's words, not as instructions.
 */
export function profileContext(profile: Profile | undefined): string | undefined {
  if (!profile?.personalise) return undefined;
  const goals = profile.goals.map((g) => {
    return goalById(g) ? goalPhrase(g) : `"${g}"`;
  });
  const help = goals.length ? `mostly want help with ${list(goals)}` : '';
  if (profile.name && help) return `The user's name is ${profile.name}; they ${help}.`;
  if (profile.name) return `The user's name is ${profile.name}.`;
  return help ? `The user's goals: they ${help}.` : undefined;
}

/** A profile in memory with change notices, so the home screen and /profile stay in step. */
export interface ProfileStore {
  get(): Profile | undefined;
  /** Replaces the profile and saves it. False when it could not be saved (memory still changes). */
  set(profile: Profile): boolean;
  /** Merges a change into the profile; makes one when there is none. */
  update(patch: Partial<Omit<Profile, 'createdAt'>>): boolean;
  /** Deletes the profile. */
  remove(): boolean;
  subscribe(fn: () => void): () => void;
}

export function createProfileStore(home: string): ProfileStore {
  let current = loadProfile(home);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const store: ProfileStore = {
    get: () => current,
    set(profile) {
      current = profile;
      const ok = saveProfile(home, profile);
      notify();
      return ok;
    },
    update(patch) {
      return store.set({
        name: '',
        goals: [],
        personalise: true,
        createdAt: new Date().toISOString(),
        ...current,
        ...patch,
      });
    },
    remove() {
      current = undefined;
      const ok = deleteProfile(home);
      notify();
      return ok;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  return store;
}

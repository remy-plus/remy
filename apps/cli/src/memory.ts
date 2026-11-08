// The user's saved notes, kept in REMY_HOME/memory.json (owner-only). Every call reads the file,
// so a second Remy process (a background task) and the chat see the same notes. A damaged file
// means no notes plus a note to the user; it is moved aside on the next save, never overwritten.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addNote,
  cleanMemoryText,
  editNote,
  MEMORY_KINDS,
  type MemoryAdd,
  type MemoryEntry,
  type MemoryKind,
  type MemoryPort,
  removeNote,
} from '@remy/tools';
import { z } from 'zod';
import { loadProfile } from './profile.ts';

const entrySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(MEMORY_KINDS),
  source: z.string().default(''),
  created: z.string().default(''),
  conflictsWith: z.array(z.string()).optional(),
});
const fileSchema = z.object({ entries: z.array(z.unknown()) });

export interface MemoryFile {
  entries: MemoryEntry[];
  /** Set when the file was damaged or partly unreadable: what was skipped and what to do. */
  note?: string;
  damaged?: true;
}

export interface MemoryStore extends MemoryPort {
  load(): MemoryFile;
  /** Replaces a note's text. False when there is no such id. */
  edit(id: string, text: string): boolean;
  /** Deletes every note. */
  clear(): number;
  subscribe(fn: () => void): () => void;
}

export const KIND_LABEL: Record<MemoryKind, string> = {
  preference: 'preference',
  about_you: 'about you',
  how_to: 'how to',
};

const pathOf = (home: string) => join(home, 'memory.json');

/** Newest first, ties by id. */
export const newestFirst = (a: MemoryEntry, b: MemoryEntry) =>
  a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1;

export function openMemory(
  home: string,
  opts: { now?: () => Date; enabled?: () => boolean } = {},
): MemoryStore {
  const path = pathOf(home);
  const now = opts.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };

  function load(): MemoryFile {
    if (!existsSync(path)) return { entries: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return {
        entries: [],
        damaged: true,
        note: `${path} could not be read, so Remy remembers nothing right now. Fix or delete the file.`,
      };
    }
    const file = fileSchema.safeParse(raw);
    if (!file.success)
      return {
        entries: [],
        damaged: true,
        note: `${path} is not in the expected shape, so Remy remembers nothing right now. Fix or delete the file.`,
      };
    const entries: MemoryEntry[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    for (const item of file.data.entries) {
      const e = entrySchema.safeParse(item);
      if (!e.success || seen.has(e.data.id)) {
        skipped += 1;
        continue;
      }
      seen.add(e.data.id);
      const text = cleanMemoryText(e.data.text);
      if (!text) skipped += 1;
      else entries.push({ ...e.data, text });
    }
    return {
      entries,
      ...(skipped && {
        note: `${skipped} note${skipped === 1 ? '' : 's'} in ${path} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`,
      }),
    };
  }

  function save(entries: MemoryEntry[], damaged: boolean): void {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    if (damaged && existsSync(path)) renameSync(path, `${path}.damaged`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    notify();
  }

  return {
    load,
    enabled: opts.enabled ?? (() => true),
    list: () => load().entries.sort(newestFirst),
    add({ text, kind, source }): MemoryAdd {
      const cur = load();
      const out = addNote(
        cur.entries,
        { text: cleanMemoryText(text), kind, source },
        { id: `mem_${randomBytes(3).toString('hex')}`, now: now().toISOString() },
      );
      if (out.changed.length) save(out.entries, cur.damaged === true);
      return out.result;
    },
    remove(id) {
      const cur = load();
      if (!cur.entries.some((e) => e.id === id)) return false;
      save(removeNote(cur.entries, id).entries, cur.damaged === true);
      return true;
    },
    edit(id, text) {
      const clean = cleanMemoryText(text);
      const cur = load();
      if (!clean || !cur.entries.some((e) => e.id === id)) return false;
      save(editNote(cur.entries, id, clean).entries, cur.damaged === true);
      return true;
    },
    clear() {
      const cur = load();
      if (!cur.entries.length && !cur.damaged) return 0;
      save([], cur.damaged === true);
      return cur.entries.length;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

/** Notes are used only when the user has a profile and has not switched personalising off. */
export const personaliseOn = (home: string): boolean => loadProfile(home)?.personalise === true;

/** The plain-text list used by `remy memory list`, `/memory list` and the minimal screen. */
export function plainMemory(file: MemoryFile, personalise: boolean): string {
  const lines = file.entries.sort(newestFirst).map((e) => {
    const clash = e.conflictsWith?.length ? `  [may contradict ${e.conflictsWith.join(', ')}]` : '';
    return `${e.id}  ${e.text}  (${KIND_LABEL[e.kind]}, ${e.created.slice(0, 10)})${clash}`;
  });
  const flagged = file.entries.filter((e) => e.conflictsWith?.length).length;
  const head = file.entries.length
    ? `Remy remembers ${file.entries.length} thing${file.entries.length === 1 ? '' : 's'} about you.`
    : 'Remy has not saved anything about you yet. When you tell it a lasting preference, it asks before saving it.';
  const tail = [
    flagged
      ? `${flagged} notes may contradict each other. Remy keeps both until you forget the one that is out of date.`
      : undefined,
    file.note,
    personalise
      ? undefined
      : 'Notes are not used right now. Turn on "Personalise replies" in /profile to use them.',
  ].filter((l): l is string => Boolean(l));
  return [head, ...lines, ...tail].join('\n');
}

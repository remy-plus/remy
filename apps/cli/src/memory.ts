// The user's saved notes, kept in the notes table of REMY_HOME/remy.sqlite (owner-only), the same
// database file the tasks use. There is no cap on how many. Two Remy processes (the chat and a
// background task) share the file: every change is one write transaction, so both always see the
// same notes. Notes used to live in REMY_HOME/memory.json; the first open imports that file once
// and renames it to memory.json.imported (never deletes it). A damaged old file is reported, left
// alone, and moved aside to memory.json.damaged on the next save.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT '', conflicts TEXT NOT NULL DEFAULT '[]'
);`;

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

/** Newest first, ties by id. */
export const newestFirst = (a: MemoryEntry, b: MemoryEntry) =>
  a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1;

type Row = Record<string, string | number | null>;

const toEntry = (r: Row): MemoryEntry => {
  let flags: unknown = [];
  try {
    flags = JSON.parse(String(r.conflicts ?? '[]'));
  } catch {}
  const ids = Array.isArray(flags) ? flags.filter((x): x is string => typeof x === 'string') : [];
  return {
    id: String(r.id),
    text: String(r.text),
    kind: r.kind as MemoryKind,
    source: String(r.source ?? ''),
    created: String(r.created ?? ''),
    ...(ids.length && { conflictsWith: ids }),
  };
};

export function openMemory(
  home: string,
  opts: { now?: () => Date; enabled?: () => boolean } = {},
): MemoryStore {
  const oldPath = join(home, 'memory.json');
  const now = opts.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const dbPath = join(home, 'remy.sqlite');
  const db = new DatabaseSync(dbPath);
  // The chat and a background task share this file: wait for a lock, do not fail.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  try {
    chmodSync(dbPath, 0o600);
  } catch {}

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const readAll = (): MemoryEntry[] =>
    (db.prepare('SELECT id, text, kind, source, created, conflicts FROM notes').all() as Row[]).map(
      toEntry,
    );
  const put = (e: MemoryEntry) =>
    db
      .prepare(
        `INSERT INTO notes (id, text, kind, source, created, conflicts) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, source = excluded.source,
           created = excluded.created, conflicts = excluded.conflicts`,
      )
      .run(e.id, e.text, e.kind, e.source, e.created, JSON.stringify(e.conflictsWith ?? []));

  /** What the last import skipped; reported for as long as this process runs. */
  let skippedNote: string | undefined;

  /** Reads the old memory.json, if there is one. Returns a note when it is damaged (and left alone). */
  function importOld(): { damaged: true; note: string } | undefined {
    if (!existsSync(oldPath)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(oldPath, 'utf8'));
    } catch {
      return {
        damaged: true,
        note: `${oldPath} could not be read, so its notes were not imported. Fix or delete the file.`,
      };
    }
    const file = fileSchema.safeParse(raw);
    if (!file.success)
      return {
        damaged: true,
        note: `${oldPath} is not in the expected shape, so its notes were not imported. Fix or delete the file.`,
      };
    tx(() => {
      // Another process may have imported it while this one waited for the lock.
      if (!existsSync(oldPath)) return;
      let skipped = 0;
      const seen = new Set<string>();
      for (const item of file.data.entries) {
        const e = entrySchema.safeParse(item);
        const text = e.success ? cleanMemoryText(e.data.text) : '';
        if (!e.success || !text || seen.has(e.data.id)) {
          skipped += 1;
          continue;
        }
        seen.add(e.data.id);
        db.prepare(
          'INSERT OR IGNORE INTO notes (id, text, kind, source, created, conflicts) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          e.data.id,
          text,
          e.data.kind,
          e.data.source,
          e.data.created,
          JSON.stringify(e.data.conflictsWith ?? []),
        );
      }
      if (skipped)
        skippedNote = `${skipped} note${skipped === 1 ? '' : 's'} in ${oldPath} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`;
      const kept = `${oldPath}.imported`;
      renameSync(oldPath, existsSync(kept) ? `${kept}-${Date.now()}` : kept);
    });
    return undefined;
  }

  function load(): MemoryFile {
    const bad = importOld();
    const note = bad?.note ?? skippedNote;
    return { entries: readAll(), ...(note && { note }), ...(bad && { damaged: true as const }) };
  }

  /** A write: first moves a still-damaged old file aside, then runs `fn` in one transaction. */
  function write<T>(fn: (entries: MemoryEntry[]) => T): T {
    const bad = importOld();
    if (bad && existsSync(oldPath)) renameSync(oldPath, `${oldPath}.damaged`);
    const out = tx(() => fn(readAll()));
    notify();
    return out;
  }

  return {
    load,
    enabled: opts.enabled ?? (() => true),
    list: () => load().entries.sort(newestFirst),
    add({ text, kind, source }): MemoryAdd {
      return write((entries) => {
        const out = addNote(
          entries,
          { text: cleanMemoryText(text), kind, source },
          { id: `mem_${randomBytes(3).toString('hex')}`, now: now().toISOString() },
        );
        for (const e of out.changed) put(e);
        return out.result;
      });
    },
    remove(id) {
      return write((entries) => {
        if (!entries.some((e) => e.id === id)) return false;
        db.prepare('DELETE FROM notes WHERE id = ?').run(id);
        for (const e of removeNote(entries, id).changed) put(e);
        return true;
      });
    },
    edit(id, text) {
      const clean = cleanMemoryText(text);
      if (!clean) return false;
      return write((entries) => {
        if (!entries.some((e) => e.id === id)) return false;
        for (const e of editNote(entries, id, clean).changed) put(e);
        return true;
      });
    },
    clear() {
      return write((entries) => {
        db.exec('DELETE FROM notes');
        return entries.length;
      });
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

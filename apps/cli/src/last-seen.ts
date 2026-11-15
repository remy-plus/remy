// When the person was last here: REMY_HOME/last-seen.json holds one timestamp, updated when they
// finish a chat turn in the terminal or the web app. `whats_new` reads it to say what happened
// while they were away. A missing or damaged file reads as "24 hours ago", so the first greeting
// still has something sensible to look back over.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const FIRST_VISIT_MS = 24 * 3_600_000;
const FILE = 'last-seen.json';
const fileSchema = z.object({ at: z.string() });

export interface LastSeen {
  /** The last visit, or 24 hours before `now` when there is none on record. */
  get(now?: Date): Date;
  /** Records a visit. A time earlier than the one on record is ignored. */
  touch(now?: Date): void;
}

export function openLastSeen(home: string): LastSeen {
  const path = join(home, FILE);
  const read = (): Date | undefined => {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (!parsed.success) return undefined;
      const d = new Date(parsed.data.at);
      return Number.isNaN(d.getTime()) ? undefined : d;
    } catch {
      return undefined;
    }
  };
  return {
    get: (now = new Date()) => read() ?? new Date(now.getTime() - FIRST_VISIT_MS),
    touch(now = new Date()) {
      const was = read();
      if (was && was.getTime() >= now.getTime()) return;
      try {
        mkdirSync(home, { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ at: now.toISOString() }), { mode: 0o600 });
        renameSync(tmp, path);
        chmodSync(path, 0o600);
      } catch {
        // A visit that cannot be recorded only means the next greeting looks back a little further.
      }
    },
  };
}

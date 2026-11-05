// Schedules on disk, in REMY_HOME/schedules.json, written whole so a crash never leaves half a file.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextRun, parseWhen, type Schedule } from './schedule.ts';

export interface ScheduleStore {
  list(): Schedule[];
  add(when: string, prompt: string, now: Date): Schedule;
  remove(id: string): boolean;
  setPaused(id: string, paused: boolean): boolean;
  /** Replaces one schedule, matched by id. */
  update(schedule: Schedule): void;
}

export function openSchedules(home: string): ScheduleStore {
  const path = join(home, 'schedules.json');
  const read = (): Schedule[] => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return Array.isArray(raw) ? (raw as Schedule[]) : [];
    } catch {
      return [];
    }
  };
  const write = (all: Schedule[]) => {
    mkdirSync(home, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  };
  return {
    list: read,
    add(when, prompt, now) {
      const parsed = parseWhen(when);
      const schedule: Schedule = {
        id: `sched_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        prompt,
        when,
        createdAt: now.toISOString(),
        nextRun: nextRun(parsed, now).toISOString(),
      };
      write([...read(), schedule]);
      return schedule;
    },
    remove(id) {
      const all = read();
      const rest = all.filter((s) => s.id !== id);
      if (rest.length === all.length) return false;
      write(rest);
      return true;
    },
    setPaused(id, paused) {
      const all = read();
      const hit = all.find((s) => s.id === id);
      if (!hit) return false;
      write(all.map((s) => (s.id === id ? { ...s, paused } : s)));
      return true;
    },
    update(schedule) {
      write(read().map((s) => (s.id === schedule.id ? schedule : s)));
    },
  };
}

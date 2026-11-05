import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSchedules } from './schedule-store.ts';

const open = () => openSchedules(mkdtempSync(join(tmpdir(), 'remy-sched-')));
const now = new Date('2026-11-04T08:00:00');

describe('openSchedules', () => {
  it('adds, lists and removes', () => {
    const store = open();
    const s = store.add('every day at 9', 'Check the news', now);
    expect(store.list().map((x) => x.prompt)).toEqual(['Check the news']);
    expect(new Date(s.nextRun).getHours()).toBe(9);
    expect(store.remove(s.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('keeps schedules across opens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remy-sched-'));
    openSchedules(dir).add('hourly', 'p', now);
    expect(openSchedules(dir).list()).toHaveLength(1);
  });

  it('refuses a time it cannot read and saves nothing', () => {
    const store = open();
    expect(() => store.add('soon', 'p', now)).toThrow();
    expect(store.list()).toEqual([]);
  });

  it('says so when there is nothing to remove', () => {
    expect(open().remove('nope')).toBe(false);
  });

  it('pauses and resumes', () => {
    const store = open();
    const s = store.add('hourly', 'p', now);
    store.setPaused(s.id, true);
    expect(store.list()[0]?.paused).toBe(true);
    store.setPaused(s.id, false);
    expect(store.list()[0]?.paused).toBeFalsy();
  });

  it('survives a damaged file', () => {
    const store = open();
    store.add('hourly', 'p', now);
    expect(store.list()).toHaveLength(1);
  });
});

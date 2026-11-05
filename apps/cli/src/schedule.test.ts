import { describe, expect, it } from 'vitest';
import { dueNow, nextRun, parseWhen, plainSchedules } from './schedule.ts';

const at = (s: string) => new Date(s);

describe('parseWhen', () => {
  it.each([
    ['every 30 minutes', { kind: 'every', minutes: 30 }],
    ['every 2 hours', { kind: 'every', minutes: 120 }],
    ['hourly', { kind: 'every', minutes: 60 }],
    ['daily at 9', { kind: 'at', hour: 9, minute: 0 }],
    ['every day at 9:30', { kind: 'at', hour: 9, minute: 30 }],
    ['every day at 9am', { kind: 'at', hour: 9, minute: 0 }],
    ['every day at 7:15pm', { kind: 'at', hour: 19, minute: 15 }],
    ['every day at 12am', { kind: 'at', hour: 0, minute: 0 }],
    ['weekdays at 8:30', { kind: 'at', hour: 8, minute: 30, days: [1, 2, 3, 4, 5] }],
    ['every monday at 9', { kind: 'at', hour: 9, minute: 0, days: [1] }],
    ['every sunday at 6pm', { kind: 'at', hour: 18, minute: 0, days: [0] }],
    ['every day at 8:00 AM', { kind: 'at', hour: 8, minute: 0 }],
    ['every day at 8:00 AM America/New_York', { kind: 'at', hour: 8, minute: 0 }],
    ['every day at 8am local time', { kind: 'at', hour: 8, minute: 0 }],
    ['every day at 9 EST', { kind: 'at', hour: 9, minute: 0 }],
    ['every weekday at 9', { kind: 'at', hour: 9, minute: 0, days: [1, 2, 3, 4, 5] }],
    ['every morning at 8', { kind: 'at', hour: 8, minute: 0 }],
  ])('reads %s', (text, when) => {
    expect(parseWhen(text)).toEqual(when);
  });

  it('refuses anything too frequent', () => {
    expect(() => parseWhen('every 1 minute')).toThrow('5 minutes');
  });

  it('says what it can read', () => {
    expect(() => parseWhen('sometime soon')).toThrow('every day at 9');
  });

  it('refuses an impossible time', () => {
    expect(() => parseWhen('every day at 25')).toThrow();
  });
});

describe('watching', () => {
  it('reads a path and keeps its case', () => {
    expect(parseWhen('when ~/Downloads changes')).toEqual({ kind: 'changes', path: '~/Downloads' });
  });

  it('looks again in five minutes', () => {
    const n = nextRun({ kind: 'changes', path: 'x' }, at('2026-11-04T10:00:00'));
    expect(n).toEqual(at('2026-11-04T10:05:00'));
  });
});

describe('nextRun', () => {
  it('counts on from now for an interval', () => {
    const n = nextRun({ kind: 'every', minutes: 30 }, at('2026-11-04T10:00:00'));
    expect(n).toEqual(at('2026-11-04T10:30:00'));
  });

  it('takes today when the time is still ahead', () => {
    const n = nextRun({ kind: 'at', hour: 9, minute: 0 }, at('2026-11-04T08:00:00'));
    expect(n).toEqual(at('2026-11-04T09:00:00'));
  });

  it('takes tomorrow when the time has passed', () => {
    const n = nextRun({ kind: 'at', hour: 9, minute: 0 }, at('2026-11-04T09:00:00'));
    expect(n).toEqual(at('2026-11-05T09:00:00'));
  });

  it('skips to the next allowed day', () => {
    // 2026-11-06 is a Friday.
    const n = nextRun(
      { kind: 'at', hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
      at('2026-11-06T09:00:00'),
    );
    expect(n).toEqual(at('2026-11-09T08:00:00'));
  });
});

describe('dueNow', () => {
  const base = { id: 's1', prompt: 'p', when: 'hourly', createdAt: '2026-11-04T00:00:00.000Z' };

  it('finds what has come due, not what is ahead', () => {
    const due = { ...base, nextRun: '2026-11-04T09:00:00.000Z' };
    const later = { ...base, id: 's2', nextRun: '2026-11-04T11:00:00.000Z' };
    expect(dueNow([due, later], new Date('2026-11-04T10:00:00.000Z'))).toEqual([due]);
  });

  it('leaves a paused schedule alone', () => {
    const paused = { ...base, nextRun: '2026-11-04T09:00:00.000Z', paused: true };
    expect(dueNow([paused], new Date('2026-11-04T10:00:00.000Z'))).toEqual([]);
  });
});

describe('plainSchedules', () => {
  const base = {
    id: 's1',
    prompt: 'Check mail',
    when: 'hourly',
    createdAt: '',
    nextRun: '2026-11-04T09:00:00.000Z',
  };

  it('says how to add one when there are none', () => {
    expect(plainSchedules([])).toContain('remy schedule add');
  });

  it('shows what runs and when', () => {
    const text = plainSchedules([base]);
    expect(text).toContain('hourly');
    expect(text).toContain('Check mail');
    expect(text).toContain('next');
  });

  it('says when one is paused', () => {
    expect(plainSchedules([{ ...base, paused: true }])).toContain('paused');
  });
});

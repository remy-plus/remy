import { describe, expect, it } from 'vitest';
import type { ConnectionRow } from './connections-view.ts';
import { MAX_BACKGROUND, situationBlock } from './situation.ts';

const now = new Date('2026-10-29T01:40:00Z');
const row = (name: string, status: ConnectionRow['status']): ConnectionRow => ({
  name,
  kind: 'remote',
  status,
  tools: 3,
  source: 'saved',
});

describe('situationBlock', () => {
  it('states the local time in the given zone', () => {
    const out = situationBlock({
      now,
      timeZone: 'America/Toronto',
      background: [],
      connections: [],
    });
    expect(out).toContain('Wednesday, 28 October 2026 at 21:40');
    expect(out).toContain('(America/Toronto)');
    expect(out).not.toContain('Background');
    expect(out).not.toContain('Connected');
  });

  it('lists live background tasks, quoted and capped, and skips finished ones', () => {
    const live = Array.from({ length: MAX_BACKGROUND + 2 }, (_, i) => ({
      id: `task_${i}`,
      state: 'running' as const,
      prompt: `job ${i} ${'x'.repeat(80)}`,
    }));
    const out = situationBlock({
      now,
      timeZone: 'UTC',
      background: [{ id: 'task_done', state: 'done', prompt: 'old' }, ...live],
      connections: [],
    });
    expect(out).not.toContain('task_done');
    expect(out).toContain('task_0 running, "job 0 x');
    expect(out).toContain('…"');
    expect(out).not.toContain(`task_${MAX_BACKGROUND}`);
  });

  it('names connected apps and the ones that need a sign-in', () => {
    const out = situationBlock({
      now,
      timeZone: 'UTC',
      background: [],
      connections: [row('github', 'connected'), row('linear', 'needs_signin'), row('x', 'failed')],
    });
    expect(out).toContain('- Connected apps: github.');
    expect(out).toContain('Need sign-in (remy connect auth <name>): linear.');
    expect(out).not.toContain(' x');
  });

  it('puts the away line right after the time, and nothing when there is none', () => {
    const base = { now, timeZone: 'UTC', background: [], connections: [] };
    const out = situationBlock({ ...base, away: '- While the person was away (a minute ago): x.' });
    const lines = out.split('\n');
    expect(lines[1]).toContain('Local time');
    expect(lines[2]).toBe('- While the person was away (a minute ago): x.');
    expect(situationBlock(base)).not.toContain('away');
  });

  it('says where the person is, with how long ago it was set, only when a location is set', () => {
    const base = { now, timeZone: 'America/New_York', background: [], connections: [] };
    const out = situationBlock({
      ...base,
      location: { place: 'Philadelphia, Pennsylvania, US', setAt: '2026-10-27T01:40:00Z' },
    });
    expect(out).toContain(
      '- Where the person is: Philadelphia, Pennsylvania, US (approximate, set 2 days ago).',
    );
    expect(situationBlock(base)).not.toContain('Where the person is');
    expect(situationBlock(base)).not.toContain('Philadelphia');
  });

  it('does not take the time zone for a location', () => {
    const out = situationBlock({
      now,
      timeZone: 'America/New_York',
      background: [],
      connections: [],
    });
    expect(out).not.toMatch(/New York/);
    expect(out).not.toContain('Where the person is');
  });

  it('leaves the line out when the stored time cannot be read', () => {
    const out = situationBlock({
      now,
      timeZone: 'UTC',
      background: [],
      connections: [],
      location: { place: 'Philadelphia', setAt: 'not a date' },
    });
    expect(out).not.toContain('Where the person is');
  });
});

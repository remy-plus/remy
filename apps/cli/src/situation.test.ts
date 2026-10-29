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
});

import type { ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { createScheduleTools, type SchedulesPort } from './schedule-tools.ts';

const ctx = {} as ToolContext;
const port = (): SchedulesPort & { added: string[] } => {
  const added: string[] = [];
  return {
    added,
    add(when, prompt) {
      if (when === 'soon') throw new Error('Say when like "every day at 9".');
      added.push(`${when}: ${prompt}`);
      return { id: 's1', nextRun: '2026-11-05T14:00:00.000Z' };
    },
    list: () => [{ id: 's1', when: 'hourly', prompt: 'p', nextRun: '2026-11-05T14:00:00.000Z' }],
  };
};
const tool = (p: SchedulesPort, name: string) => {
  const t = createScheduleTools(p).find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};

describe('schedule tools', () => {
  it('needs an approval to add a schedule', () => {
    expect(tool(port(), 'schedule_task').risk).toBe('write');
  });

  it('shows the exact schedule on the card', () => {
    const preview = tool(port(), 'schedule_task').preview({ when: 'hourly', prompt: 'Check mail' });
    expect(preview).toContain('hourly');
    expect(preview).toContain('Check mail');
  });

  it('adds a schedule', async () => {
    const p = port();
    const r = await tool(p, 'schedule_task').execute({ when: 'hourly', prompt: 'Check mail' }, ctx);
    expect(r.ok).toBe(true);
    expect(p.added).toEqual(['hourly: Check mail']);
  });

  it('passes on a time it cannot read', async () => {
    const r = await tool(port(), 'schedule_task').execute({ when: 'soon', prompt: 'p' }, ctx);
    expect(r).toMatchObject({ ok: false });
  });

  it('is never retried by itself', () => {
    expect(tool(port(), 'schedule_task').effect).toBe('unsafe_to_retry');
  });

  it('lists schedules as a read', async () => {
    const t = tool(port(), 'list_schedules');
    expect(t.risk).toBe('read');
    const r = await t.execute({}, ctx);
    expect(r.ok && r.content).toContain('hourly');
  });
});

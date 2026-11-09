import { DEFAULT_BUDGET, type TaskConfig } from '@remy/core';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { createHome } from './serve-home.ts';
import { openWebPrefs } from './serve-settings.ts';

const config: TaskConfig = {
  model: 'm',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};

describe('home and tasks that lost their runner', () => {
  it('does not count a task marked running for hours as running, and says it stopped', async () => {
    const store = new MemoryEventStore();
    await store.createTask('task_old', 'Research headphones', config);
    const home = createHome({
      store,
      prefs: openWebPrefs('/nonexistent-remy-home'),
      spend: async () => 0,
      machines: () => 0,
      notesCount: () => 0,
      now: () => new Date(Date.now() + 2 * 3_600_000),
    });
    const r = await home();
    expect(r.status.running).toBe(0);
    expect(r.working).toEqual([]);
    expect(r.briefing.rest).toBe('Nothing is running.');
    expect(r.noticed.map((n: { text: string }) => n.text).join(' ')).toMatch(
      /1 task stopped without finishing/,
    );
  });

  it('still counts a task with recent activity as running', async () => {
    const store = new MemoryEventStore();
    await store.createTask('task_new', 'Rename invoices', config);
    const home = createHome({
      store,
      prefs: openWebPrefs('/nonexistent-remy-home'),
      spend: async () => 0,
      machines: () => 0,
      notesCount: () => 0,
    });
    const r = await home();
    expect(r.status.running).toBe(1);
    expect(r.working).toHaveLength(1);
  });
});

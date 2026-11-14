// The words the web app shows for a task that failed: plain, with the next step, never a raw body.
import { DEFAULT_BUDGET, fold } from '@remy/core';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { taskView } from './serve-view.ts';

async function failedTask(reason: string) {
  const store = new MemoryEventStore();
  await store.createTask('t1', 'do it', {
    model: 'm',
    permissions: { autoApprove: [] },
    budget: DEFAULT_BUDGET,
    workspaceDir: '/w',
  });
  const lease = await store.acquireLease('t1', 'o', 1000);
  if (!lease) throw new Error('no lease');
  await store.append('t1', 1, [{ type: 'task.finished', status: 'failed', reason }], lease);
  return fold(await store.read('t1'));
}

describe('taskView on a failed task', () => {
  it('says what happened to a wrong key in a sentence, and keeps no raw body', async () => {
    const s = await failedTask(
      'The model failed: HTTP 401: {"error":{"message":"Incorrect API key provided: sk-abc"}}',
    );
    const view = taskView(s, (t) => t, {
      running: false,
      outcome: { status: 'failed', reason: s.final?.reason },
    });
    expect(view.final?.reason).toBe(
      'The key was rejected. Run remy login in a terminal to replace it.',
    );
    expect(JSON.stringify(view)).not.toMatch(/HTTP 401|sk-abc/);
  });

  it('leaves a reason it has no words for as it was', async () => {
    const s = await failedTask('The task needed a tool that is not installed.');
    const view = taskView(s, (t) => t, { running: false });
    expect(view.final?.reason).toBe('The task needed a tool that is not installed.');
  });
});

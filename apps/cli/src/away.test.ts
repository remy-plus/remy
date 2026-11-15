import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, type Event } from '@remy/core';
import { MemoryEventStore } from '@remy/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAwayPort } from './away.ts';
import { writeMarker } from './background.ts';
import { openLastSeen } from './last-seen.ts';
import type { Schedule } from './schedule.ts';

const NOW = new Date('2026-11-14T12:00:00Z');
const HOUR = 3_600_000;
let home: string;
let clock: number;
let store: MemoryEventStore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-away-'));
  clock = NOW.getTime() - 2 * HOUR;
  store = new MemoryEventStore({ now: () => clock });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const config = {
  model: 'm',
  permissions: { autoApprove: [] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};

async function seed(id: string, prompt: string, events: Event[]) {
  await store.createTask(id, prompt, config);
  if (!events.length) return;
  const lease = await store.acquireLease(id, 'test', 60_000);
  if (!lease) throw new Error('no lease');
  await store.append(id, 1, events, lease);
  await store.releaseLease(lease);
}

const finished = (answer: string): Event => ({
  type: 'task.finished',
  status: 'succeeded',
  answer,
});
const waiting: Event[] = [
  {
    type: 'model.responded',
    step: 1,
    calls: [{ callId: 'c0', tool: 'email_send', args: {}, argsHash: 'h' }],
    usage: { inTokens: 1, outTokens: 1 },
    costUsd: 0,
    latencyMs: 1,
  },
  {
    type: 'policy.decided',
    callId: 'c0',
    decision: { kind: 'require_approval', reason: 'sends as you' },
    risk: 'send_as_user',
  },
  {
    type: 'approval.requested',
    callId: 'c0',
    argsHash: 'h',
    preview: 'Send email to sam@example.com: "Rent is paid"',
    risk: 'send_as_user',
    reason: 'sends as you',
  },
];

function port(schedules: Schedule[] = []) {
  const seen = openLastSeen(home);
  seen.touch(new Date(NOW.getTime() - 3 * HOUR));
  return createAwayPort({ store, home, seen, schedules: () => schedules, now: () => NOW });
}

describe('away port', () => {
  it('reads the last visit from the store of visits', () => {
    expect(port().since().toISOString()).toBe('2026-11-14T09:00:00.000Z');
  });

  it('lists finished work since the visit with what was asked and the answer', async () => {
    await seed('task_a', 'check the Sony price', [finished('The pair dropped to $248.')]);
    const p = port();
    const items = await p.items(p.since(), 'task_me');
    expect(items).toMatchObject([
      { kind: 'finished', asked: 'check the Sony price', outcome: 'The pair dropped to $248.' },
    ]);
  });

  it('leaves out the current task and work from before the visit', async () => {
    clock = NOW.getTime() - 5 * HOUR;
    await seed('task_old', 'earlier', [finished('done')]);
    clock = NOW.getTime() - HOUR;
    await seed('task_me', 'hi', []);
    const p = port();
    expect(await p.items(p.since(), 'task_me')).toEqual([]);
  });

  it('shows the card text of a task waiting, even from before the visit', async () => {
    clock = NOW.getTime() - 2 * 24 * HOUR;
    await seed('task_w', 'email Sam', waiting);
    const p = port();
    const [item] = await p.items(p.since(), 'task_me');
    expect(item?.kind).toBe('waiting');
    expect(item?.outcome).toContain('Send email to sam@example.com');
  });

  it('drops open tasks older than a week', async () => {
    clock = NOW.getTime() - 9 * 24 * HOUR;
    await seed('task_w', 'email Sam', waiting);
    const p = port();
    expect(await p.items(p.since(), 'task_me')).toEqual([]);
  });

  it('names a failed task and a paused one', async () => {
    await seed('task_f', 'fetch report', [
      { type: 'task.finished', status: 'failed', reason: 'the site refused us' },
    ]);
    await seed('task_p', 'long job', [
      { type: 'budget.exhausted', limit: 'model', steps: 1, costUsd: 0, elapsedMs: 1 } as Event,
    ]);
    const p = port();
    const items = await p.items(p.since(), 'task_me');
    expect(items.find((i) => i.taskId === 'task_f')).toMatchObject({
      kind: 'failed',
      outcome: 'the site refused us',
    });
    expect(items.find((i) => i.taskId === 'task_p')).toMatchObject({
      kind: 'paused',
      outcome: 'the model could not be reached',
    });
  });

  it('marks scheduled, background and webhook runs, and webhook text as untrusted', async () => {
    await seed('task_s', 'daily price check', [finished('ok')]);
    await seed('task_b', 'tidy notes', [finished('ok')]);
    writeMarker(home, 'task_b', { pid: 1, startedAt: new Date(clock).toISOString() });
    await seed('task_h', '[webhook orders] new order', [finished('ok')]);
    const sched = { id: 's1', when: 'daily', prompt: 'x', lastTask: 'task_s' } as Schedule;
    const p = port([sched]);
    const items = await p.items(p.since(), 'task_me');
    const by = Object.fromEntries(items.map((i) => [i.taskId, i]));
    expect(by.task_s?.source).toBe('schedule');
    expect(by.task_b?.source).toBe('background');
    expect(by.task_h).toMatchObject({ source: 'webhook', tainted: true });
  });

  it('cleans control characters out of what was asked', async () => {
    await seed('task_c', 'look\u001b[31m up\nprices', [finished('ok')]);
    const p = port();
    const [item] = await p.items(p.since(), 'task_me');
    expect(item?.asked).toBe('look [31m up prices');
  });
});

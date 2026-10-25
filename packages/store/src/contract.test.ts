// Spec for every EventStore. Phase 1's Postgres store must pass this file unchanged.
import { ConcurrencyError, DEFAULT_BUDGET, type EventStore, type TaskConfig } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { MemoryEventStore, SqliteEventStore } from './index.ts';

const config: TaskConfig = {
  model: 'm',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/tmp/w',
};
const failed = { type: 'model.failed', step: 1, error: 'e', retryable: true, attempt: 1 } as const;

const impls: [string, (now: () => number) => EventStore][] = [
  ['memory', (now) => new MemoryEventStore({ now })],
  ['sqlite', (now) => new SqliteEventStore(':memory:', { now })],
];

for (const [name, make] of impls) {
  describe(`${name} EventStore`, () => {
    const setup = async () => {
      const clock = { t: Date.parse('2026-10-24T00:00:00Z') };
      const store = make(() => clock.t);
      await store.createTask('t1', 'hello', config);
      return { store, clock };
    };

    it('creates a task with task.created at seq 1', async () => {
      const { store } = await setup();
      const events = await store.read('t1');
      expect(events).toEqual([
        {
          taskId: 't1',
          seq: 1,
          at: '2026-10-24T00:00:00.000Z',
          event: { type: 'task.created', prompt: 'hello', config },
        },
      ]);
      await expect(store.createTask('t1', 'again', config)).rejects.toThrow();
    });

    it('appends atomically and reads from a seq', async () => {
      const { store } = await setup();
      const lease = await store.acquireLease('t1', 'w1', 1000);
      expect(lease).not.toBeNull();
      if (!lease) return;
      expect(await store.append('t1', 1, [failed, { ...failed, attempt: 2 }], lease)).toBe(3);
      const after = await store.read('t1', 2);
      expect(after.map((e) => e.seq)).toEqual([2, 3]);
      expect(after[1]?.event).toEqual({ ...failed, attempt: 2 });
    });

    it('rejects a stale expectedSeq and writes nothing', async () => {
      const { store } = await setup();
      const lease = await store.acquireLease('t1', 'w1', 1000);
      if (!lease) throw new Error('no lease');
      await store.append('t1', 1, [failed], lease);
      await expect(store.append('t1', 1, [failed, failed], lease)).rejects.toBeInstanceOf(
        ConcurrencyError,
      );
      expect(await store.read('t1')).toHaveLength(2);
    });

    it('allows one lease holder at a time until it expires', async () => {
      const { store, clock } = await setup();
      const a = await store.acquireLease('t1', 'w1', 1000);
      expect(a).not.toBeNull();
      expect(await store.acquireLease('t1', 'w2', 1000)).toBeNull();
      clock.t += 1001;
      const b = await store.acquireLease('t1', 'w2', 1000);
      expect(b).not.toBeNull();
      if (!a || !b) return;
      // The old holder lost the lease: it can neither append nor renew.
      await expect(store.append('t1', 1, [failed], a)).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await store.renewLease(a)).toBe(false);
      expect(await store.append('t1', 1, [failed], b)).toBe(2);
    });

    it('rejects an expired lease even if nobody took over', async () => {
      const { store, clock } = await setup();
      const a = await store.acquireLease('t1', 'w1', 1000);
      if (!a) throw new Error('no lease');
      clock.t += 1001;
      await expect(store.append('t1', 1, [failed], a)).rejects.toBeInstanceOf(ConcurrencyError);
    });

    it('renews and releases', async () => {
      const { store, clock } = await setup();
      const a = await store.acquireLease('t1', 'w1', 1000);
      if (!a) throw new Error('no lease');
      clock.t += 800;
      expect(await store.renewLease(a)).toBe(true);
      clock.t += 800; // past the original expiry, inside the renewed one
      expect(await store.append('t1', 1, [failed], a)).toBe(2);
      await store.releaseLease(a);
      expect(await store.acquireLease('t1', 'w2', 1000)).not.toBeNull();
    });

    it('lets exactly one of two racing writers win', async () => {
      const { store } = await setup();
      const lease = await store.acquireLease('t1', 'w1', 1000);
      if (!lease) throw new Error('no lease');
      const results = await Promise.allSettled([
        store.append('t1', 1, [failed], lease),
        store.append('t1', 1, [{ ...failed, attempt: 2 }], lease),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await store.read('t1')).toHaveLength(2);
    });

    it('caches status and lists tasks', async () => {
      const { store, clock } = await setup();
      await store.createTask('t2', 'other', config);
      const lease = await store.acquireLease('t1', 'w1', 1000);
      if (!lease) throw new Error('no lease');
      clock.t += 5;
      await store.append('t1', 1, [{ type: 'task.finished', status: 'succeeded' }], lease);
      const done = await store.listTasks({ status: 'succeeded' });
      expect(done.map((t) => t.taskId)).toEqual(['t1']);
      expect(done[0]?.updatedAt).toBe('2026-10-24T00:00:00.005Z');
      expect((await store.listTasks()).map((t) => t.taskId).sort()).toEqual(['t1', 't2']);
      expect((await store.listTasks({ status: 'running' }))[0]?.prompt).toBe('other');
    });

    it('updates cached status for waiting states', async () => {
      const { store } = await setup();
      const lease = await store.acquireLease('t1', 'w1', 1000);
      if (!lease) throw new Error('no lease');
      await store.append('t1', 1, [{ type: 'user.asked', question: 'q' }], lease);
      expect((await store.listTasks())[0]?.status).toBe('waiting_user');
    });
  });
}

describe('SqliteEventStore', () => {
  it('persists across instances on disk', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'remy-')), 'remy.sqlite');
    const a = new SqliteEventStore(path);
    await a.createTask('t1', 'p', config);
    a.close();
    const b = new SqliteEventStore(path);
    expect(await b.read('t1')).toHaveLength(1);
    b.close();
  });
});

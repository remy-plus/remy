import { DEFAULT_BUDGET, type Event, type TaskConfig } from '@remy/core';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { Crash, crashingStore, withTransient } from './faults.ts';
import { inboxTools } from './world.ts';

const config: TaskConfig = {
  model: 'm',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};
const responded: Event = {
  type: 'model.responded',
  step: 1,
  calls: [{ callId: 'c1', tool: 'email_send', args: {}, argsHash: 'h' }],
  usage: { inTokens: 1, outTokens: 1 },
  costUsd: 0,
  latencyMs: 0,
};

async function setup(faults: Parameters<typeof crashingStore>[1]) {
  const inner = new MemoryEventStore();
  const c = crashingStore(inner, faults);
  await c.store.createTask('t', 'p', config);
  const lease = await c.store.acquireLease('t', 'a', 1000);
  if (!lease) throw new Error('no lease');
  return { inner, c, lease };
}

describe('crashingStore', () => {
  it('crashes before the matching append, once', async () => {
    const { inner, c, lease } = await setup([
      { kind: 'crash', when: 'before', event: 'model.responded' },
    ]);
    await expect(c.store.append('t', 1, [responded], lease)).rejects.toThrow(Crash);
    expect(await inner.read('t')).toHaveLength(1);
    await c.store.releaseLease(lease); // dead: ignored
    expect(await inner.acquireLease('t', 'b', 1000)).toBeNull();
    c.revive();
    await c.store.releaseLease(lease);
    expect(c.crashes()).toBe(1);
    const again = await inner.acquireLease('t', 'b', 1000);
    expect(again).not.toBeNull();
  });

  it('crashes after the append lands, and filters by tool', async () => {
    const { inner, c, lease } = await setup([
      { kind: 'crash', when: 'after', event: 'tool.started', tool: 'email_send' },
    ]);
    await c.store.append('t', 1, [responded], lease);
    const started: Event = { type: 'tool.started', callId: 'c1', idempotencyKey: 'k', attempt: 1 };
    await expect(
      c.store.append(
        't',
        2,
        [{ type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' } }, started],
        lease,
      ),
    ).rejects.toThrow(Crash);
    expect(await inner.read('t')).toHaveLength(4);
  });

  it('ignores a crash fault for another tool', async () => {
    const { c, lease } = await setup([
      { kind: 'crash', when: 'after', event: 'policy.decided', tool: 'pay' },
    ]);
    await c.store.append('t', 1, [responded], lease);
    await c.store.append(
      't',
      2,
      [{ type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' } }],
      lease,
    );
    expect(c.crashes()).toBe(0);
  });
});

describe('withTransient', () => {
  it('fails the first n executions then delegates', async () => {
    const sent: never[] = [];
    const [read] = withTransient(inboxTools([], sent), [
      { kind: 'transient', tool: 'email_read', times: 2 },
    ]);
    const ctx = { idempotencyKey: 'k' } as never;
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await read?.execute({}, ctx));
    expect(results.map((r) => r?.ok)).toEqual([false, false, true]);
  });
});

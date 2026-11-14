// A task whose model cannot be reached is saved and paused, not thrown away: the person carries on later.
import { createRuntime, DEFAULT_BUDGET, ModelError, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { describe, expect, it } from 'vitest';

const answer = (text: string) => ({
  calls: [{ tool: 'finish', args: { answer: text } }],
  usage: { inTokens: 1, outTokens: 1 },
});
const down = () => new ModelError('network error: fetch failed', true, { unreachable: true });

function make(steps: ConstructorParameters<typeof ScriptedModelClient>[0]) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(steps);
  const runtime = createRuntime({
    store,
    model,
    tools: new ToolRegistry([finish]),
    owner: 'down',
    capabilities: (c) => ({
      fs: createScopedFs(c.workspaceDir),
      net: createScopedFetch({}),
      secrets: { get: () => undefined },
    }),
    sleep: async () => {},
  });
  const start = () =>
    runtime.start('do it', {
      model: 'test',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/tmp',
    });
  return { runtime, start, model };
}

describe('a model that cannot be reached', () => {
  it('pauses the task after the retries instead of failing it', async () => {
    const { runtime, start } = make(Array.from({ length: 5 }, down));
    const id = await start();
    const out = await runtime.advance(id);
    expect(out).toMatchObject({ status: 'paused', limit: 'model' });
  });

  it('carries on from the pause with fresh retries and no extra budget', async () => {
    const { runtime, start } = make([...Array.from({ length: 5 }, down), answer('Done.')]);
    const id = await start();
    await runtime.advance(id);
    const before = (await runtime.state(id)).config.budget;
    await runtime.extend(id, { steps: 30 });
    expect((await runtime.state(id)).config.budget.maxSteps).toBe(before.maxSteps);
    expect(await runtime.advance(id)).toMatchObject({ status: 'succeeded', answer: 'Done.' });
  });

  it('still fails for a model that answers badly rather than not at all', async () => {
    const { runtime, start } = make(
      Array.from({ length: 5 }, () => new ModelError('the model returned an empty reply', true)),
    );
    const id = await start();
    expect(await runtime.advance(id)).toMatchObject({ status: 'failed' });
  });
});

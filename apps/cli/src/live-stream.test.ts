// What the runtime hands to a live screen while a model is writing: `start` before each call,
// plain text, and the answer of a finish call. Nothing else, and nothing is stored.
import { createRuntime, DEFAULT_BUDGET, type LiveEvent, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { describe, expect, it } from 'vitest';

const usage = { inTokens: 1, outTokens: 1 };

async function run(steps: ConstructorParameters<typeof ScriptedModelClient>[0]) {
  const store = new MemoryEventStore();
  const seen: { id: string; e: LiveEvent }[] = [];
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient(steps),
    tools: new ToolRegistry([finish]),
    owner: 'live',
    capabilities: (c) => ({
      fs: createScopedFs(c.workspaceDir),
      net: createScopedFetch({}),
      secrets: { get: () => undefined },
    }),
    sleep: async () => {},
    onLive: (id, e) => seen.push({ id, e }),
  });
  const id = await runtime.start('hi', {
    model: 'test',
    permissions: { autoApprove: ['read'] },
    budget: DEFAULT_BUDGET,
    workspaceDir: '/tmp',
  });
  await runtime.advance(id);
  return { id, seen, store };
}

describe('onLive', () => {
  it('announces each model call and passes on the finish answer', async () => {
    const { id, seen } = await run([
      { calls: [{ tool: 'finish', args: { answer: 'Welcome back.' } }], usage },
    ]);
    expect(seen).toEqual([
      { id, e: { kind: 'start' } },
      { id, e: { kind: 'answer', delta: 'Welcome back.' } },
    ]);
  });

  it('passes on plain text, tagged as text', async () => {
    const { seen } = await run([{ text: 'Hello there', calls: [], usage }]);
    expect(seen.map((s) => s.e)).toEqual([
      { kind: 'start' },
      { kind: 'text', delta: 'Hello there' },
    ]);
  });

  it('keeps every delta out of the stored events', async () => {
    const { id, store } = await run([
      { text: 'SECRET-NARRATION', calls: [{ tool: 'finish', args: { answer: 'ok' } }], usage },
    ]);
    const kinds = (await store.read(id)).map((e) => e.event.type);
    expect(kinds).not.toContain('model.delta');
    expect(kinds).toContain('model.responded');
  });
});

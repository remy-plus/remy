// Long runs through the real runtime: pause and extend, crash while paused, the plan gate, progress notes.
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type ModelResponse,
  type Runtime,
  type TaskConfig,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const t = (name: string, run: (a: Record<string, unknown>) => string) =>
  defineTool({
    name,
    description: name,
    args: z.object({}).passthrough(),
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: () => name,
    execute: async (a) => ({
      ok: true,
      content: run(a as Record<string, unknown>),
      trust: 'trusted',
    }),
  });
const tools = () =>
  new ToolRegistry([
    t('finish', (a) => String(a.answer ?? 'done')),
    t('update_plan', () => 'ok'),
    t('read_file', (a) => `file ${String(a.n)}`),
  ]);

const config = (budget: Partial<typeof DEFAULT_BUDGET> = {}): TaskConfig => ({
  model: 'scripted',
  permissions: { autoApprove: ['read'] },
  budget: { ...DEFAULT_BUDGET, ...budget },
  workspaceDir: '/w',
});
const call = (tool: string, args: unknown = {}): ModelResponse => ({
  calls: [{ tool, args }],
  usage: { inTokens: 1, outTokens: 1 },
});
// Each read is different, so the loop guard stays quiet.
const read = (n: number) => call('read_file', { n });
const reads = (n: number) => Array.from({ length: n }, (_, i) => read(i));
const make = (store: MemoryEventStore, model: ScriptedModelClient): Runtime =>
  createRuntime({
    store,
    model,
    tools: tools(),
    capabilities: () => ({
      // biome-ignore lint/suspicious/noExplicitAny: the fake tools never touch these
      fs: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: the fake tools never touch these
      net: {} as any,
      secrets: { get: () => undefined },
    }),
    sleep: async () => {},
    random: () => 0,
  });
const types = async (store: MemoryEventStore, id: string) =>
  (await store.read(id)).map((e) => e.event.type);

describe('budget pause', () => {
  it('pauses at the step limit instead of failing, then continues after extend', async () => {
    const store = new MemoryEventStore();
    const model = new ScriptedModelClient([...reads(3), call('finish', { answer: 'ok' })]);
    const rt = make(store, model);
    const id = await rt.start('go', config({ maxSteps: 2 }));
    expect(await rt.advance(id)).toMatchObject({ status: 'paused', limit: 'steps', steps: 2 });
    await rt.extend(id, { steps: 5 });
    const s = fold(await store.read(id));
    expect(s.status).toBe('running');
    expect(s.config.budget.maxSteps).toBe(7);
    expect(s.initialBudget.maxSteps).toBe(2);
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded', answer: 'ok' });
    expect(await types(store, id)).toContain('budget.exhausted');
    expect(await types(store, id)).toContain('budget.extended');
  });

  it('pauses at the cost limit', async () => {
    const rt = make(new MemoryEventStore(), new ScriptedModelClient(reads(2)));
    const id = await rt.start('go', config({ maxCostUsd: 0 }));
    expect(await rt.advance(id)).toMatchObject({ status: 'paused', limit: 'cost' });
  });

  it('refuses to extend a task that is not paused', async () => {
    const rt = make(new MemoryEventStore(), new ScriptedModelClient([]));
    const id = await rt.start('go', config());
    await expect(rt.extend(id, { steps: 1 })).rejects.toThrow(/not paused/);
  });

  it('stays paused across a restart and resumes from the log', async () => {
    const store = new MemoryEventStore();
    const first = make(store, new ScriptedModelClient(reads(1)));
    const id = await first.start('go', config({ maxSteps: 1 }));
    await first.advance(id);
    // A new process: only the events survive.
    const rt2 = make(store, new ScriptedModelClient([call('finish', { answer: 'back' })]));
    expect(await rt2.advance(id)).toMatchObject({ status: 'paused' });
    await rt2.extend(id, { steps: 3 });
    expect(await rt2.advance(id)).toMatchObject({ status: 'succeeded', answer: 'back' });
  });

  it('can be cancelled while paused', async () => {
    const store = new MemoryEventStore();
    const rt = make(store, new ScriptedModelClient(reads(1)));
    const id = await rt.start('go', config({ maxSteps: 1 }));
    await rt.advance(id);
    await rt.cancel(id, 'user');
    expect(fold(await store.read(id)).status).toBe('cancelled');
  });
});

describe('plan gate', () => {
  const plan = (...status: string[]) =>
    call('update_plan', { steps: status.map((s, i) => ({ text: `Step ${i + 1}`, status: s })) });

  it('answers the first finish with open steps, then lets the second through', async () => {
    const store = new MemoryEventStore();
    const model = new ScriptedModelClient([
      plan('done', 'pending'),
      call('finish', { answer: 'early' }),
      call('finish', { answer: 'really done' }),
    ]);
    const rt = make(store, model);
    const id = await rt.start('go', config());
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded', answer: 'really done' });
    const results = (await store.read(id)).flatMap((e) =>
      e.event.type === 'tool.completed' ? [e.event.result] : [],
    );
    const gated = results.find((r) => !r.ok);
    expect(gated && !gated.ok && gated.error).toMatch(/Step 2 \(pending\)/);
  });

  it('lets finish through when every step is done or skipped', async () => {
    const model = new ScriptedModelClient([
      plan('done', 'skipped'),
      call('finish', { answer: 'ok' }),
    ]);
    const rt = make(new MemoryEventStore(), model);
    expect(await rt.advance(await rt.start('go', config()))).toMatchObject({
      status: 'succeeded',
    });
  });

  it('does nothing without a plan', async () => {
    const model = new ScriptedModelClient([call('finish', { answer: 'ok' })]);
    const rt = make(new MemoryEventStore(), model);
    expect(await rt.advance(await rt.start('go', config()))).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('progress notes', () => {
  it('records one every 10 steps, from the plan', async () => {
    const store = new MemoryEventStore();
    const replies: ModelResponse[] = [
      call('update_plan', {
        steps: [
          { text: 'Read the files', status: 'done' },
          { text: 'Compare prices.', status: 'doing' },
          { text: 'Write it up', status: 'pending' },
        ],
      }),
      ...reads(11),
      call('finish', { answer: 'ok' }),
    ];
    const rt = make(store, new ScriptedModelClient(replies));
    const id = await rt.start('go', config({ maxSteps: 50 }));
    await rt.advance(id);
    const notes = (await store.read(id)).flatMap((e) =>
      e.event.type === 'progress' ? [e.event] : [],
    );
    expect(notes).toEqual([{ type: 'progress', step: 10, text: 'Step 2 of 3: compare prices' }]);
  });

  it('falls back to a plain count without a plan', async () => {
    const store = new MemoryEventStore();
    const rt = make(store, new ScriptedModelClient([...reads(10), call('finish')]));
    const id = await rt.start('go', config({ maxSteps: 50 }));
    await rt.advance(id);
    const note = (await store.read(id)).find((e) => e.event.type === 'progress')?.event;
    expect(note).toMatchObject({ step: 10, text: '10 steps in, $0.00 spent.' });
  });
});

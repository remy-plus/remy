// Helpers through the real runtime: child tasks, their limits, taint, budget and crash recovery.
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type ModelResponse,
  type TaskConfig,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { delegate } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const t = (
  name: string,
  trust: 'trusted' | 'untrusted' = 'trusted',
  risk: 'read' | 'write' = 'read',
) =>
  defineTool({
    name,
    description: name,
    args: z.object({}).passthrough(),
    risk,
    effect: 'none',
    outputTrust: trust,
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: () => name,
    execute: async (a) => ({
      ok: true,
      content: String((a as { answer?: string }).answer ?? name),
      trust,
    }),
  });

const tools = () =>
  new ToolRegistry([
    t('finish'),
    t('read_page', 'untrusted'),
    t('send_note', 'trusted', 'write'),
    delegate,
  ]);

const config: TaskConfig = {
  model: 'scripted',
  permissions: { autoApprove: ['read', 'write'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};

const calls = (...c: [string, unknown][]): ModelResponse =>
  ({
    calls: c.map(([tool, args], i) => ({ callId: `c${i}-${tool}-${Math.random()}`, tool, args })),
    usage: { inTokens: 10, outTokens: 10 },
    costUsd: 0.01,
    finish: 'tool_calls',
  }) as unknown as ModelResponse;
const say = (text: string): ModelResponse =>
  ({
    text,
    calls: [],
    usage: { inTokens: 10, outTokens: 10 },
    costUsd: 0.01,
    finish: 'stop',
  }) as unknown as ModelResponse;

const setup = (script: ModelResponse[], registry = tools()) => {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(script);
  const rt = createRuntime({
    store,
    model,
    tools: registry,
    capabilities: () => ({}) as never,
    sleep: async () => {},
  });
  return { store, model, rt, registry };
};

const children = async (store: MemoryEventStore) => {
  const all = await store.listTasks();
  const out = [];
  for (const task of all) {
    const s = fold(await store.read(task.taskId ?? (task as unknown as { id: string }).id));
    if (s.config.parent) out.push(s);
  }
  return out;
};

describe('delegate', () => {
  it('runs a helper as a child task and returns its answer', async () => {
    const { rt, store } = setup([
      calls(['delegate', { helpers: [{ role: 'researcher', task: 'Find rye' }] }]),
      say('Rye is a grain.'),
      say('It is a grain.'),
    ]);
    const id = await rt.start('What is rye?', config);
    const done = await rt.advance(id);
    expect(done).toMatchObject({ status: 'succeeded', answer: 'It is a grain.' });
    const [child] = await children(store);
    expect(child?.config.parent?.taskId).toBe(id);
  });

  it('adds what the helper spent to the parent', async () => {
    const { rt, store } = setup([
      calls(['delegate', { helpers: [{ task: 'Find rye' }] }]),
      say('Rye.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    const events = await store.read(id);
    const done = events.find((e) => e.event.type === 'tool.completed')?.event;
    const [child] = await children(store);
    expect(done).toMatchObject({ result: { spentUsd: child?.costUsd } });
  });

  it('gives a helper no write tools, whatever the parent may do', async () => {
    const { rt, store } = setup([
      calls(['delegate', { helpers: [{ task: 'Send it' }] }]),
      calls(['send_note', {}]),
      say('I could not.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    expect(child?.config.permissions.denyTools).toContain('send_note');
    expect(child?.config.permissions.autoApprove).toEqual(['read']);
    const events = await store.read(child?.taskId as string);
    expect(events.some((e) => e.event.type === 'tool.started')).toBe(false);
  });

  it('taints the parent when a helper read untrusted content', async () => {
    const { rt } = setup([
      calls(['delegate', { helpers: [{ task: 'Read it' }] }]),
      calls(['read_page', {}]),
      say('The page says hi.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    expect((await rt.state(id)).tainted).toBe(true);
  });

  it('leaves the parent clean when no helper read untrusted content', async () => {
    const { rt } = setup([
      calls(['delegate', { helpers: [{ task: 'Think' }] }]),
      say('Thought.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    expect((await rt.state(id)).tainted).toBe(false);
  });

  it('starts a helper of a tainted task tainted', async () => {
    const { rt, store } = setup([
      calls(['read_page', {}]),
      calls(['delegate', { helpers: [{ task: 'Think' }] }]),
      say('Thought.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    expect(child?.tainted).toBe(true);
  });

  it('does not let a helper start helpers', async () => {
    const { rt, store } = setup([
      calls(['delegate', { helpers: [{ task: 'Go' }] }]),
      calls(['delegate', { helpers: [{ task: 'Again' }] }]),
      say('Stopped.'),
      say('Done.'),
    ]);
    const id = await rt.start('p', config);
    await rt.advance(id);
    expect(await children(store)).toHaveLength(1);
  });

  it('reports a helper that stops without an answer and carries on', async () => {
    const { rt } = setup([
      calls(['delegate', { helpers: [{ task: 'Go' }] }]),
      say('Which one?'),
      say('Done anyway.'),
    ]);
    const id = await rt.start('p', config);
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded' });
  });
});

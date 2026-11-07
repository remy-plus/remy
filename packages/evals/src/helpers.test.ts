// Helpers through the real runtime: child tasks, their limits, taint, budget and crash recovery.
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type HelperRole,
  type ModelResponse,
  parseRoles,
  type TaskConfig,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createDelegate, delegate } from '@remy/tools';
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

const setup = (
  script: ModelResponse[],
  registry = tools(),
  extra: { helperRoles?: HelperRole[]; helpersAct?: boolean } = {},
) => {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(script);
  const rt = createRuntime({
    store,
    model,
    tools: registry,
    capabilities: () => ({}) as never,
    sleep: async () => {},
    ...extra,
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

/** Runs until the helper finished, then stops the parent as a crash would: no result recorded. */
async function crashAfterHelper(
  rt: ReturnType<typeof setup>['rt'],
  store: MemoryEventStore,
  id: string,
): Promise<string> {
  const realAppend = store.append.bind(store);
  store.append = async (taskId, seq, events, lease) => {
    if (taskId === id && events.some((e) => e.type === 'tool.completed')) throw new Error('crash');
    return realAppend(taskId, seq, events, lease);
  };
  await rt.advance(id).catch(() => {});
  store.append = realAppend;
  const [child] = await children(store);
  return child?.taskId as string;
}

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

  it('picks up the same helper after a crash instead of starting another', async () => {
    const script = [
      calls(['delegate', { helpers: [{ task: 'Go' }] }]),
      say('Found.'),
      say('Done.'),
    ];
    const { rt, store, registry } = setup(script);
    const id = await rt.start('p', config);
    const child = await crashAfterHelper(rt, store, id);
    const again = createRuntime({
      store,
      model: new ScriptedModelClient([say('Done after the crash.')]),
      tools: registry,
      capabilities: () => ({}) as never,
      sleep: async () => {},
    });
    expect(await again.advance(id)).toMatchObject({ status: 'succeeded' });
    const helpers = await children(store);
    expect(helpers.map((h) => h.taskId)).toEqual([child]);
  });
});

// Role helpers and helpers that act. Approval for a helper's call reaches the user through the
// parent task, and the decision is applied to the helper.
const roles = (text: string, source: 'user' | 'project' = 'user') => parseRoles(text, source).roles;

describe('roles', () => {
  it('puts the role instructions in the helper and narrows its tools', async () => {
    const { rt, store } = setup(
      [
        calls(['delegate', { helpers: [{ role: 'scout', task: 'Look' }] }]),
        say('Looked.'),
        say('Done.'),
      ],
      tools(),
      { helperRoles: roles('## scout\nTools: read_page\nLook twice.') },
    );
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    expect(child?.prompt).toContain('How to do this job: Look twice.');
    expect(child?.config.permissions.denyTools).toEqual(
      expect.arrayContaining(['send_note', 'delegate']),
    );
    expect(child?.config.permissions.denyTools).not.toContain('read_page');
  });

  it('cannot widen: a role listing a write tool does not open it', async () => {
    const { rt, store } = setup(
      [calls(['delegate', { helpers: [{ role: 'scout', task: 'Go' }] }]), say('No.'), say('Done.')],
      tools(),
      { helperRoles: roles('## scout\nTools: send_note, read_page\nAct: yes\nGo.') },
    );
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    // The host did not allow acting, so the role's Act line does nothing.
    expect(child?.config.permissions.denyTools).toContain('send_note');
  });

  it('starts a helper with a project role tainted', async () => {
    const { rt, store } = setup(
      [calls(['delegate', { helpers: [{ role: 'scout', task: 'Go' }] }]), say('ok'), say('Done.')],
      tools(),
      { helperRoles: roles('## scout\nGo.', 'project') },
    );
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    expect(child?.tainted).toBe(true);
    // What a tainted helper returns is untrusted, so the parent is tainted too.
    expect((await rt.state(id)).tainted).toBe(true);
  });

  it('treats a role name it does not know as a label', async () => {
    const { rt, store } = setup(
      [calls(['delegate', { helpers: [{ role: 'wizard', task: 'Go' }] }]), say('ok'), say('Done.')],
      tools(),
    );
    const id = await rt.start('p', config);
    await rt.advance(id);
    const [child] = await children(store);
    expect(child?.prompt).toContain('You are a wizard helper');
  });
});

describe('helpers that act', () => {
  const filer = roles('## filer\nAct: yes\nFile the note.');
  let ran: number;
  const noteTool = (effect: 'unsafe_to_retry' | 'none' = 'unsafe_to_retry') =>
    defineTool({
      name: 'send_note',
      description: 'send a note',
      args: z.object({}).passthrough(),
      risk: 'write',
      effect,
      outputTrust: 'trusted',
      timeoutMs: 1000,
      maxOutputChars: 1000,
      preview: () => 'send the note',
      execute: async () => {
        ran++;
        return { ok: true, content: 'sent', trust: 'trusted' };
      },
    });
  const registry = (act = true, effect: 'unsafe_to_retry' | 'none' = 'unsafe_to_retry') =>
    new ToolRegistry([
      t('finish'),
      t('read_page', 'untrusted'),
      noteTool(effect),
      createDelegate(filer, { act }),
    ]);
  const parentConfig: TaskConfig = { ...config, permissions: { autoApprove: ['read', 'write'] } };
  const delegateFiler = calls(['delegate', { helpers: [{ role: 'filer', task: 'File it' }] }]);

  it('hands the helper card up through the parent, and runs the call once on approval', async () => {
    ran = 0;
    const { rt } = setup(
      [delegateFiler, calls(['send_note', {}]), say('Filed.'), say('All filed.')],
      registry(),
      { helperRoles: filer, helpersAct: true },
    );
    const id = await rt.start('p', parentConfig);
    const first = await rt.advance(id);
    expect(first.status).toBe('waiting_approval');
    if (first.status !== 'waiting_approval') return;
    expect(first.request.preview).toBe('Helper (filer) asks: send the note');
    expect(ran).toBe(0);
    // A wrong hash is refused, and nothing runs.
    await expect(rt.approve(id, first.request.callId, 'bad', true, 'user')).rejects.toThrow(
      /different arguments/,
    );
    await rt.approve(id, first.request.callId, first.request.argsHash, true, 'user');
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded', answer: 'All filed.' });
    expect(ran).toBe(1);
    // Single use: the same approval cannot be spent again.
    await expect(
      rt.approve(id, first.request.callId, first.request.argsHash, true, 'user'),
    ).rejects.toThrow();
  });

  it('asks again when the parent is resumed while the helper still waits', async () => {
    ran = 0;
    const { rt } = setup([delegateFiler, calls(['send_note', {}])], registry(), {
      helperRoles: filer,
      helpersAct: true,
    });
    const id = await rt.start('p', parentConfig);
    const a = await rt.advance(id);
    const b = await rt.advance(id);
    expect(b).toEqual(a);
    expect(ran).toBe(0);
  });

  it('stops the action when the user says no, and the helper cannot go round it', async () => {
    ran = 0;
    const { rt, store } = setup(
      [delegateFiler, calls(['send_note', {}]), say('The user said no.'), say('It was not filed.')],
      registry(),
      { helperRoles: filer, helpersAct: true },
    );
    const id = await rt.start('p', parentConfig);
    const first = await rt.advance(id);
    if (first.status !== 'waiting_approval') throw new Error('expected a card');
    await rt.approve(id, first.request.callId, first.request.argsHash, false, 'user', 'not now');
    expect(await rt.advance(id)).toMatchObject({
      status: 'succeeded',
      answer: 'It was not filed.',
    });
    expect(ran).toBe(0);
    const [child] = await children(store);
    expect(Object.values(child?.calls ?? {}).some((c) => c.result?.ok)).toBe(false);
  });

  it('never acts unless the host allows it', async () => {
    ran = 0;
    const { rt, store } = setup(
      [delegateFiler, calls(['send_note', {}]), say('I could not.'), say('Not filed.')],
      registry(false),
      { helperRoles: filer, helpersAct: false },
    );
    const id = await rt.start('p', parentConfig);
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded' });
    expect(ran).toBe(0);
    const [child] = await children(store);
    expect(child?.config.permissions.denyTools).toContain('send_note');
  });

  it('does not give the acting helper the parent standing approvals', async () => {
    ran = 0;
    const { rt, store } = setup([delegateFiler, calls(['send_note', {}])], registry(), {
      helperRoles: filer,
      helpersAct: true,
    });
    const id = await rt.start('p', {
      ...parentConfig,
      permissions: { autoApprove: ['read', 'write'], standing: ['send_note'] },
    });
    const first = await rt.advance(id);
    expect(first.status).toBe('waiting_approval');
    const [child] = await children(store);
    expect(child?.config.permissions.standing).toBeUndefined();
    expect(ran).toBe(0);
  });

  it('allows only one acting helper in one delegate call', async () => {
    ran = 0;
    const { rt } = setup(
      [
        calls([
          'delegate',
          {
            helpers: [
              { role: 'filer', task: 'One' },
              { role: 'filer', task: 'Two' },
            ],
          },
        ]),
        say('Then one at a time.'),
      ],
      registry(),
      { helperRoles: filer, helpersAct: true },
    );
    const id = await rt.start('p', parentConfig);
    expect(await rt.advance(id)).toMatchObject({ status: 'succeeded' });
    expect(ran).toBe(0);
  });

  it('keeps the other helpers finishing while one waits', async () => {
    ran = 0;
    const { rt, store } = setup(
      [
        calls([
          'delegate',
          {
            helpers: [{ role: 'filer', task: 'File it' }, { task: 'Think' }],
          },
        ]),
        calls(['send_note', {}]),
        say('Thought.'),
      ],
      registry(),
      { helperRoles: filer, helpersAct: true },
    );
    const id = await rt.start('p', parentConfig);
    expect((await rt.advance(id)).status).toBe('waiting_approval');
    expect(await children(store)).toHaveLength(2);
  });

  it('after a crash in the middle of an unsafe call, the helper ends it as unknown and does not repeat it', async () => {
    ran = 0;
    const reg = registry();
    const { rt, store } = setup([delegateFiler, calls(['send_note', {}])], reg, {
      helperRoles: filer,
      helpersAct: true,
    });
    const id = await rt.start('p', parentConfig);
    const first = await rt.advance(id);
    if (first.status !== 'waiting_approval') throw new Error('expected a card');
    await rt.approve(id, first.request.callId, first.request.argsHash, true, 'user');
    // The call runs once, then the process dies before the result is written.
    const [child] = await children(store);
    const real = store.append.bind(store);
    let dead = false;
    store.append = async (taskId, seq, events, lease) => {
      if (dead || (taskId === child?.taskId && events.some((e) => e.type === 'tool.completed'))) {
        dead = true;
        throw new Error('crash');
      }
      return real(taskId, seq, events, lease);
    };
    await rt.advance(id).catch(() => {});
    store.append = real;
    expect(ran).toBe(1);
    const mid = fold(await store.read(child?.taskId as string));
    expect(Object.values(mid.calls).some((c) => c.inFlight)).toBe(true);
    // A new process picks up the parent, then the helper.
    const again = createRuntime({
      store,
      model: new ScriptedModelClient([
        say('I cannot tell what happened.'),
        say('It is not known what happened.'),
      ]),
      tools: reg,
      capabilities: () => ({}) as never,
      sleep: async () => {},
      helperRoles: filer,
      helpersAct: true,
    });
    const o = await again.advance(id);
    expect(o).toMatchObject({
      status: 'succeeded',
      answer: 'It is not known what happened.',
    });
    expect(ran).toBe(1);
    const after = fold(await store.read(child?.taskId as string));
    const call = Object.values(after.calls).find((c) => c.tool === 'send_note');
    expect(call?.result).toMatchObject({ ok: false, phase: 'unknown' });
  });
});

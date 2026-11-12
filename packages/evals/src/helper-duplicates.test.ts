// A crash in a helper's send, then a parent that does the send itself: one email, never two.
// Reproduces the live run of recovery-helper-crash-mid-action (Claude Haiku 5.5).
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type ModelResponse,
  parseRoles,
  type RunOutcome,
  type TaskConfig,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createDelegate } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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

const filer = parseRoles('## filer\nAct: yes\nFile it.', 'user').roles;
const config: TaskConfig = {
  model: 'scripted',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};
const mail = { to: 'me@example.test', subject: 'Report', body: 'Text' };
const delegateFiler = calls(['delegate', { helpers: [{ role: 'filer', task: 'Email it' }] }]);

function world(effect: 'reconcilable' | 'unsafe_to_retry') {
  const sent: { key: string; to: string }[] = [];
  const email = defineTool({
    name: 'email_send',
    description: 'send an email',
    args: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    risk: 'send_as_user',
    effect,
    outputTrust: 'trusted',
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: ({ to, subject }) => `Send an email to ${to} with subject "${subject}"`,
    execute: async ({ to }, ctx) => {
      sent.push({ key: ctx.idempotencyKey, to });
      return { ok: true, content: `Email sent to ${to}`, trust: 'trusted' };
    },
    ...(effect === 'reconcilable' && {
      reconcile: async (_a: unknown, ctx: { idempotencyKey: string }) =>
        sent.some((m) => m.key === ctx.idempotencyKey)
          ? {
              done: true as const,
              result: { ok: true as const, content: 'Email sent', trust: 'trusted' as const },
            }
          : { done: false as const },
    }),
  });
  const finish = defineTool({
    name: 'finish',
    description: 'finish',
    args: z.object({ answer: z.string() }),
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: () => 'finish',
    execute: async (a) => ({ ok: true, content: a.answer, trust: 'trusted' }),
  });
  const registry = () => new ToolRegistry([finish, email, createDelegate(filer, { act: true })]);
  return { sent, registry };
}

/** The helper's process dies right after `tool.started` for email_send; a new one carries on. */
async function crashThenRecover(
  effect: 'reconcilable' | 'unsafe_to_retry',
  first: ModelResponse[],
  second: ModelResponse[],
) {
  const { sent, registry } = world(effect);
  const store = new MemoryEventStore();
  const make = (script: ModelResponse[]) =>
    createRuntime({
      store,
      model: new ScriptedModelClient(script),
      tools: registry(),
      capabilities: () => ({}) as never,
      sleep: async () => {},
      helperRoles: filer,
      helpersAct: true,
    });
  const drive = async (rt: ReturnType<typeof make>, id: string): Promise<RunOutcome> => {
    for (let i = 0; i < 10; i++) {
      const o = await rt.advance(id);
      if (o.status !== 'waiting_approval') return o;
      await rt.approve(id, o.request.callId, o.request.argsHash, true, 'user');
    }
    throw new Error('too many cards');
  };
  const rt1 = make(first);
  const id = await rt1.start('Have a filer email the report to me@example.test.', config);
  const real = store.append.bind(store);
  let dead = false;
  store.append = async (taskId, seq, events, lease) => {
    if (dead) throw new Error('crash');
    const r = await real(taskId, seq, events, lease);
    // The helper's only tool is email_send, so its first `tool.started` is the send.
    if (taskId !== id && events.some((e) => e.type === 'tool.started')) dead = true;
    return r;
  };
  await drive(rt1, id).catch(() => {});
  store.append = real;
  expect(dead).toBe(true);
  const outcome = await drive(make(second), id);
  return { sent, outcome, state: fold(await store.read(id)) };
}

describe('a helper crashes mid-send and the parent then answers', () => {
  it('sends once: the parent is not told that nothing was sent, so it does not send itself', async () => {
    const { sent, outcome, state } = await crashThenRecover(
      'reconcilable',
      [delegateFiler, calls(['email_send', mail])],
      [
        say('Sent.'),
        say('The report has been emailed to me@example.test.'),
        // What a live model did after being told that no message was sent:
        calls(['email_send', { ...mail, body: 'Text again' }]),
        say('Done.'),
      ],
    );
    expect(sent).toHaveLength(1);
    expect(outcome).toMatchObject({ status: 'succeeded' });
    const result = Object.values(state.calls).find((c) => c.tool === 'delegate')?.result;
    expect(result?.ok && result.content).toContain('This already happened');
  });

  it('if a model sends it itself anyway, the policy refuses the repeat without a card', async () => {
    const { sent, state } = await crashThenRecover(
      'reconcilable',
      [delegateFiler, calls(['email_send', mail])],
      [say('Sent.'), calls(['email_send', { ...mail, body: 'Another body' }]), say('Done.')],
    );
    expect(sent).toHaveLength(1);
    const own = Object.values(state.calls).find((c) => c.tool === 'email_send');
    expect(own?.decision).toMatchObject({ kind: 'deny' });
    expect(own?.result).toMatchObject({ ok: false });
    expect(own?.approvalRequest).toBeUndefined();
  });

  it('an interrupted helper send the helper cannot confirm reaches the parent as unknown, and is not repeated', async () => {
    const { sent, state } = await crashThenRecover(
      'unsafe_to_retry',
      [delegateFiler, calls(['email_send', mail])],
      [say('I cannot tell.'), calls(['email_send', mail]), say('It is not known if it was sent.')],
    );
    const result = Object.values(state.calls).find((c) => c.tool === 'delegate')?.result;
    expect(result?.ok && result.content).toContain('OUTCOME UNKNOWN');
    expect(result?.ok && result.content).toContain('me@example.test');
    expect(result?.ok && result.content).toContain('Do not do it again');
    // The send ran once before the process died; nothing retried it, and the parent's own try is refused.
    expect(sent).toHaveLength(1);
    const own = Object.values(state.calls).find((c) => c.tool === 'email_send');
    expect(own?.decision).toMatchObject({ kind: 'deny' });
    expect(own?.approvalRequest).toBeUndefined();
  });
});

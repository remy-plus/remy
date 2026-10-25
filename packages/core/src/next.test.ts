import { describe, expect, it } from 'vitest';
import { argsHash } from './hash.ts';
import { isQuestion, nextAction } from './next.ts';
import { fold } from './state.ts';
import { DEFAULT_BUDGET, type Event } from './types.ts';

const T0 = Date.parse('2026-10-24T00:00:00Z');
const created: Event = {
  type: 'task.created',
  prompt: 'p',
  config: {
    model: 'm',
    permissions: { autoApprove: ['read'] },
    budget: DEFAULT_BUDGET,
    workspaceDir: '/w',
  },
};
const st = (...events: Event[]) =>
  fold(
    [created, ...events].map((event, i) => ({
      taskId: 't',
      seq: i + 1,
      at: new Date(T0).toISOString(),
      event,
    })),
  );
const call = (callId: string, tool = 'read_file', args: unknown = { p: callId }) => ({
  callId,
  tool,
  args,
  argsHash: argsHash(args),
});
const resp = (step: number, ...calls: ReturnType<typeof call>[]): Event => ({
  type: 'model.responded',
  step,
  calls,
  usage: { inTokens: 1, outTokens: 1 },
  costUsd: 0,
  latencyMs: 1,
});
const allow = (callId: string): Event => ({
  type: 'policy.decided',
  callId,
  decision: { kind: 'allow' },
});
const started = (callId: string, attempt = 1): Event => ({
  type: 'tool.started',
  callId,
  idempotencyKey: 'k',
  attempt,
});
const done = (callId: string, content = 'x'): Event => ({
  type: 'tool.completed',
  callId,
  result: { ok: true, content, trust: 'trusted' },
  latencyMs: 1,
});
const next = (...events: Event[]) => nextAction(st(...events), T0);

describe('nextAction', () => {
  it('calls the model first', () => expect(next()).toEqual({ kind: 'call_model' }));

  it('walks a call through decide → execute → next model call', () => {
    expect(next(resp(1, call('a')))).toEqual({ kind: 'decide', callId: 'a' });
    expect(next(resp(1, call('a')), allow('a'))).toEqual({ kind: 'execute', callId: 'a' });
    expect(next(resp(1, call('a')), allow('a'), started('a'))).toEqual({
      kind: 'recover',
      callId: 'a',
    });
    expect(next(resp(1, call('a')), allow('a'), started('a'), done('a'))).toEqual({
      kind: 'call_model',
    });
  });

  it('handles calls in order', () => {
    expect(next(resp(1, call('a'), call('b')), allow('a'), started('a'), done('a'))).toEqual({
      kind: 'decide',
      callId: 'b',
    });
  });

  it('requests approval when the decision needs one and none was recorded', () => {
    expect(
      next(resp(1, call('a')), {
        type: 'policy.decided',
        callId: 'a',
        decision: { kind: 'require_approval', reason: 'r' },
      }),
    ).toEqual({ kind: 'request_approval', callId: 'a' });
  });

  it('pauses while waiting', () => {
    expect(next({ type: 'user.asked', question: 'q' })).toEqual({ kind: 'pause' });
  });

  it('retries after a recorded failure', () => {
    expect(
      next(resp(1, call('a')), allow('a'), started('a'), {
        type: 'tool.failed',
        callId: 'a',
        error: 'e',
        retryable: true,
        attempt: 1,
      }),
    ).toEqual({ kind: 'execute', callId: 'a' });
  });

  it('routes ask_user and the uncertain-call answer', () => {
    const ask = call('a', 'ask_user', { question: 'q' });
    expect(next(resp(1, ask), allow('a'))).toEqual({ kind: 'ask_user', callId: 'a' });
    expect(
      next(
        resp(1, ask),
        allow('a'),
        { type: 'user.asked', question: 'q', callId: 'a' },
        { type: 'user.answered', answer: 'x' },
      ),
    ).toEqual({ kind: 'answer_call', callId: 'a' });
    expect(
      next(
        resp(1, call('p', 'pay')),
        allow('p'),
        started('p'),
        { type: 'user.asked', question: 'retry?', callId: 'p' },
        { type: 'user.answered', answer: 'retry' },
      ),
    ).toEqual({ kind: 'resolve_uncertain', callId: 'p' });
  });

  it('finishes on a successful finish call or a text-only reply', () => {
    const f = call('f', 'finish', { answer: 'ok' });
    expect(next(resp(1, f), allow('f'), started('f'), done('f', 'ok'))).toMatchObject({
      kind: 'finish',
      status: 'succeeded',
      answer: 'ok',
    });
    expect(next({ ...(resp(1) as object), text: 'hi' } as Event)).toMatchObject({
      kind: 'finish',
      answer: 'hi',
    });
  });

  it('enforces cancel, wall time, steps and loops', () => {
    expect(next({ type: 'task.cancel_requested', by: 'u' })).toMatchObject({
      kind: 'finish',
      status: 'cancelled',
    });
    expect(nextAction(st(), T0 + DEFAULT_BUDGET.maxWallMs + 1)).toMatchObject({
      kind: 'finish',
      status: 'failed',
    });
    const same = (id: string, step: number) => [
      resp(step, call(id, 'read_file', { p: 'same' })),
      allow(id),
      started(id),
      done(id),
    ];
    expect(next(...same('a', 1), ...same('b', 2), ...same('c', 3))).toMatchObject({
      reason: expect.stringContaining('repeated'),
    });
  });

  it('asks the user when a text-only reply is just a question, then calls the model', () => {
    const q = { ...(resp(1) as object), text: 'Which folder?' } as Event;
    expect(next(q)).toEqual({ kind: 'ask', question: 'Which folder?' });
    expect(
      next(
        q,
        { type: 'user.asked', question: 'Which folder?' },
        { type: 'user.answered', answer: 'Downloads' },
      ),
    ).toEqual({ kind: 'call_model' });
  });

  it('only treats one short sentence ending in ? as a question', () => {
    expect(isQuestion("What is your manager's email address?")).toBe(true);
    expect(isQuestion('The page has no phone number. Want me to search for it?')).toBe(false);
    expect(isQuestion('Done.\nAnything else?')).toBe(false);
    expect(isQuestion('All set.')).toBe(false);
  });

  it('is done after the task finishes', () => {
    expect(next({ type: 'task.finished', status: 'failed' })).toEqual({ kind: 'done' });
  });
});

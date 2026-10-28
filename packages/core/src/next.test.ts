import { describe, expect, it } from 'vitest';
import { argsHash } from './hash.ts';
import { isQuestion, nextAction } from './next.ts';
import { PLAN_GATE_PREFIX } from './plan.ts';
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
    expect(nextAction(st(), T0 + DEFAULT_BUDGET.maxWallMs + 1)).toEqual({
      kind: 'exhaust',
      limit: 'time',
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
    const other = [
      resp(3, call('w', 'write_file', { p: 'out' })),
      allow('w'),
      started('w'),
      done('w'),
    ];
    expect(next(...same('a', 1), ...same('b', 2), ...other, ...same('c', 4))).toMatchObject({
      kind: 'call_model',
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

  it('only treats one short sentence that asks as a question', () => {
    expect(isQuestion("What is your manager's email address?")).toBe(true);
    expect(isQuestion('The page has no phone number. Want me to search for it?')).toBe(false);
    expect(isQuestion('Done.\nAnything else?')).toBe(false);
    expect(isQuestion('All set.')).toBe(false);
    expect(
      isQuestion("Please provide your manager's email address and the subject line you'd like."),
    ).toBe(true);
    expect(isQuestion('Let me know if you need anything else.')).toBe(false);
    expect(isQuestion('Sent the note. Please confirm it arrived.')).toBe(false);
  });

  it('is done after the task finishes', () => {
    expect(next({ type: 'task.finished', status: 'failed' })).toEqual({ kind: 'done' });
  });
});

const exhausted: Event = {
  type: 'budget.exhausted',
  limit: 'steps',
  steps: 1,
  costUsd: 0.4,
  elapsedMs: 5,
};
const extended: Event = {
  type: 'budget.extended',
  maxSteps: 60,
  maxCostUsd: 2,
  maxWallMs: DEFAULT_BUDGET.maxWallMs,
  by: 'user',
};
const stepsTo = (n: number): Event[] =>
  Array.from({ length: n }, (_, i) => [
    resp(i + 1, call(`c${i}`, 'read_file', { p: i })),
    allow(`c${i}`),
    started(`c${i}`),
    done(`c${i}`),
  ]).flat();

describe('pause and extend', () => {
  const small = (...events: Event[]) =>
    fold(
      [
        {
          ...created,
          config: {
            ...(created as { config: object }).config,
            budget: { ...DEFAULT_BUDGET, maxSteps: 2 },
          },
        } as Event,
        ...events,
      ].map((event, i) => ({ taskId: 't', seq: i + 1, at: new Date(T0).toISOString(), event })),
    );

  it('exhausts at the step and cost limits instead of failing', () => {
    expect(nextAction(small(...stepsTo(2)), T0)).toEqual({ kind: 'exhaust', limit: 'steps' });
    const pricey = {
      ...(resp(1, call('c', 'read_file')) as object),
      costUsd: 1,
    } as Event;
    expect(next(pricey, allow('c'), started('c'), done('c'))).toEqual({
      kind: 'exhaust',
      limit: 'cost',
    });
  });

  it('pauses on budget.exhausted and waits', () => {
    const s = small(...stepsTo(2), exhausted);
    expect(s.status).toBe('paused');
    expect(s.pause).toMatchObject({ limit: 'steps', steps: 1 });
    expect(nextAction(s, T0)).toEqual({ kind: 'pause' });
  });

  it('runs again after budget.extended, with the new limits', () => {
    const s = small(...stepsTo(2), exhausted, extended);
    expect(s.status).toBe('running');
    expect(s.pause).toBeUndefined();
    expect(s.config.budget.maxSteps).toBe(60);
    expect(s.initialBudget.maxSteps).toBe(2);
    expect(nextAction(s, T0)).toEqual({ kind: 'call_model' });
  });

  it('only allows extend while paused and exhaust while running', () => {
    expect(() => next(extended)).toThrow(/not allowed while running/);
    expect(() => next(exhausted, exhausted)).toThrow(/not allowed while paused/);
  });

  it('can be cancelled while paused', () => {
    const s = small(...stepsTo(2), exhausted, { type: 'task.cancel_requested', by: 'u' });
    expect(nextAction(s, T0)).toMatchObject({ kind: 'finish', status: 'cancelled' });
  });
});

describe('progress and the plan gate', () => {
  it('asks for a progress note at every tenth step, once', () => {
    expect(next(...stepsTo(9))).toEqual({ kind: 'call_model' });
    expect(next(...stepsTo(10))).toEqual({ kind: 'progress' });
    expect(next(...stepsTo(10), { type: 'progress', step: 10, text: 'x' })).toEqual({
      kind: 'call_model',
    });
  });

  const plan = (status: string) => [
    resp(1, call('p', 'update_plan', { steps: [{ text: 'Do it', status }] })),
    allow('p'),
    started('p'),
    done('p'),
  ];
  const fin = (id = 'f', step = 2) => [resp(step, call(id, 'finish', { answer: 'a' })), allow(id)];

  it('gates finish while a plan step is open', () => {
    expect(next(...plan('doing'), ...fin())).toEqual({ kind: 'gate_finish', callId: 'f' });
    expect(next(...plan('done'), ...fin())).toEqual({ kind: 'execute', callId: 'f' });
    expect(next(...plan('skipped'), ...fin())).toEqual({ kind: 'execute', callId: 'f' });
    expect(next(...fin('f', 1))).toEqual({ kind: 'execute', callId: 'f' });
  });

  it('gates only once', () => {
    const gated: Event = {
      type: 'tool.completed',
      callId: 'f',
      result: {
        ok: false,
        error: `${PLAN_GATE_PREFIX}\n- Do it (doing)`,
        retryable: false,
        phase: 'before_effect',
      },
      latencyMs: 0,
    };
    expect(next(...plan('doing'), ...fin(), gated, ...fin('g', 3))).toEqual({
      kind: 'execute',
      callId: 'g',
    });
  });
});

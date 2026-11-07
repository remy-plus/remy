import { describe, expect, it } from 'vitest';
import { argsHash } from './hash.ts';
import { buildMessages } from './messages.ts';
import { nextAction } from './next.ts';
import { ToolRegistry } from './registry.ts';
import { canPark, fold, InvalidTransitionError, waitingCards } from './state.ts';
import { DEFAULT_BUDGET, type Event, type PlannedCall, type TrustLevel } from './types.ts';

const T0 = Date.parse('2026-11-07T00:00:00Z');
const created = (trust?: TrustLevel, extra: object = {}): Event => ({
  type: 'task.created',
  prompt: 'p',
  config: {
    model: 'm',
    permissions: { autoApprove: ['read'], ...(trust && { trust }) },
    budget: DEFAULT_BUDGET,
    workspaceDir: '/w',
    ...extra,
  },
});
const st = (head: Event, ...events: Event[]) =>
  fold(
    [head, ...events].map((event, i) => ({
      taskId: 't',
      seq: i + 1,
      at: new Date(T0).toISOString(),
      event,
    })),
  );
const call = (callId: string, tool = 'email_send'): PlannedCall => {
  const args = { to: callId };
  return { callId, tool, args, argsHash: argsHash(args) };
};
const resp = (step: number, ...calls: PlannedCall[]): Event => ({
  type: 'model.responded',
  step,
  calls,
  usage: { inTokens: 1, outTokens: 1 },
  costUsd: 0,
  latencyMs: 1,
});
const needs = (callId: string): Event => ({
  type: 'policy.decided',
  callId,
  decision: {
    kind: 'require_approval',
    reason: 'Sending something as you always needs your approval',
  },
  risk: 'send_as_user',
});
const card = (callId: string, parked?: number): Event => ({
  type: 'approval.requested',
  callId,
  argsHash: argsHash({ to: callId }),
  preview: `email ${callId}`,
  risk: 'send_as_user',
  reason: 'x',
  ...(parked !== undefined && { parked }),
});
const answer = (callId: string, granted: boolean, left?: number): Event => ({
  type: 'approval.resolved',
  callId,
  argsHash: argsHash({ to: callId }),
  granted,
  by: 'user',
  ...(left !== undefined && { left }),
});
const finishCall = (): PlannedCall => ({
  callId: 'f',
  tool: 'finish',
  args: { answer: 'Done.' },
  argsHash: argsHash({ answer: 'Done.' }),
});
const NOW = T0 + 1000;

const parkedOne = (): Event[] => [resp(1, call('a')), needs('a'), card('a', 1)];

describe('waiting cards', () => {
  it('a parked card leaves the task running and is derived from events', () => {
    const s = st(created('away'), ...parkedOne());
    expect(s.status).toBe('running');
    expect(s.pendingApproval).toBeUndefined();
    expect(waitingCards(s).map((c) => c.callId)).toEqual(['a']);
    expect(nextAction(s, NOW).kind).toBe('call_model');
  });

  it('refuses a parked card at any other level, in a helper, or past the fourth', () => {
    for (const head of [
      created('steady'),
      created(undefined),
      created('away', { parent: { taskId: 'p', callId: 'c' } }),
    ])
      expect(() => st(head, ...parkedOne())).toThrow(InvalidTransitionError);
    const four = [
      resp(1, call('a'), call('b'), call('c'), call('d')),
      needs('a'),
      card('a', 1),
      needs('b'),
      card('b', 2),
      needs('c'),
      card('c', 3),
      needs('d'),
    ];
    expect(() => st(created('away'), ...four, card('d', 4))).toThrow(InvalidTransitionError);
    const s = st(created('away'), ...four, card('d'));
    expect(s.status).toBe('waiting_approval');
    expect(s.pendingApproval?.callId).toBe('d');
    expect(canPark(s)).toBe(false);
  });

  it('canPark is false below away and for helpers', () => {
    expect(canPark(st(created('steady'), resp(1, call('a'))))).toBe(false);
    expect(canPark(st(created('away'), resp(1, call('a'))))).toBe(true);
    expect(canPark(st(created('away', { helperRole: 'r' }), resp(1, call('a'))))).toBe(false);
  });

  it('holds when the model tries to finish, and never lets finish succeed', () => {
    const s = st(created('away'), ...parkedOne(), resp(2, finishCall()), {
      type: 'policy.decided',
      callId: 'f',
      decision: { kind: 'allow' },
    });
    expect(nextAction(s, NOW)).toEqual({ kind: 'hold', callId: 'f' });
  });

  it('holds a plain final reply too', () => {
    const s = st(created('away'), ...parkedOne(), {
      type: 'model.responded',
      step: 2,
      text: 'Everything else is done.',
      calls: [],
      usage: { inTokens: 1, outTokens: 1 },
      costUsd: 0,
      latencyMs: 1,
    });
    expect(nextAction(s, NOW)).toEqual({ kind: 'hold' });
  });

  it('a held task pauses on the first card; the last answer resumes it and runs the call', () => {
    const held = st(created('away'), ...parkedOne(), {
      type: 'approvals.held',
      summary: 'x',
    });
    expect(held.status).toBe('waiting_approval');
    expect(held.pendingApproval?.callId).toBe('a');
    expect(nextAction(held, NOW).kind).toBe('pause');
    const back = st(
      created('away'),
      ...parkedOne(),
      { type: 'approvals.held', summary: 'x' },
      answer('a', true, 0),
    );
    expect(back.status).toBe('running');
    expect(back.held).toBeUndefined();
    // Even after later steps, the approved call runs as recorded.
    expect(nextAction(back, NOW)).toEqual({ kind: 'execute', callId: 'a' });
  });

  it('holds with two cards until both are answered', () => {
    const two = [
      resp(1, call('a'), call('b')),
      needs('a'),
      card('a', 1),
      needs('b'),
      card('b', 2),
      { type: 'approvals.held', summary: 'x' } as Event,
    ];
    const one = st(created('away'), ...two, answer('b', true, 1));
    expect(one.status).toBe('waiting_approval');
    expect(one.pendingApproval?.callId).toBe('a');
    expect(() => st(created('away'), ...two, answer('b', true, 0))).toThrow(InvalidTransitionError);
  });

  it('a denial records the call as declined and tells the model afterwards', () => {
    const s = st(
      created('away'),
      ...parkedOne(),
      { type: 'approvals.held', summary: 'x' },
      answer('a', false, 0),
    );
    expect(s.calls.a?.result?.ok).toBe(false);
    expect(nextAction(s, NOW).kind).toBe('call_model');
    const text = JSON.stringify(buildMessages(s, new ToolRegistry()));
    expect(text).toContain('declined');
    expect(text).not.toContain('waiting for the user');
  });

  it('tells the model plainly what waits while the task goes on', () => {
    const s = st(created('away'), ...parkedOne());
    const last = buildMessages(s, new ToolRegistry()).at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('waiting for the user');
    expect(last?.content).toContain('email a');
    expect(last?.content).toContain('Carry on');
  });

  it('a tainted task keeps its cards: parking never clears a call', () => {
    const s = st(created('away', { startTainted: true }), ...parkedOne());
    expect(s.tainted).toBe(true);
    expect(s.calls.a?.approval).toBeUndefined();
    expect(nextAction(s, NOW).kind).toBe('call_model');
  });
});

import { describe, expect, it } from 'vitest';
import { argsHash, canonicalJson } from './hash.ts';
import { fold, InvalidTransitionError, reduce } from './state.ts';
import { DEFAULT_BUDGET, type Event, type StoredEvent, type TaskConfig } from './types.ts';

const config: TaskConfig = {
  model: 'test',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/tmp/w',
};

const at = '2026-10-24T00:00:00.000Z';
const log = (...events: Event[]): StoredEvent[] =>
  events.map((event, i) => ({ taskId: 't1', seq: i + 1, at, event }));

const created: Event = { type: 'task.created', prompt: 'hi', config };
const call = (callId: string, tool = 'read_file', args: unknown = { path: 'a' }) => ({
  callId,
  tool,
  args,
  argsHash: argsHash(args),
});
const responded = (step: number, ...calls: ReturnType<typeof call>[]): Event => ({
  type: 'model.responded',
  step,
  calls,
  usage: { inTokens: 10, outTokens: 5 },
  costUsd: 0.01,
  latencyMs: 100,
});
const ok = (content = 'x', trust: 'trusted' | 'untrusted' = 'trusted') =>
  ({ ok: true, content, trust }) as const;

const expectInvalid = (...events: Event[]) =>
  expect(() => fold(log(...events))).toThrow(InvalidTransitionError);

describe('hash', () => {
  it('is independent of key order and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
    expect(argsHash({ a: 1, b: 2 })).toBe(argsHash({ b: 2, a: 1 }));
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });
});

describe('reducer', () => {
  it('folds a full happy path', () => {
    const s = fold(
      log(
        created,
        responded(1, call('c1')),
        { type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' } },
        { type: 'tool.started', callId: 'c1', idempotencyKey: 't1:c1', attempt: 1 },
        { type: 'tool.completed', callId: 'c1', result: ok(), latencyMs: 5 },
        { type: 'task.finished', status: 'succeeded', answer: 'done' },
      ),
    );
    expect(s.status).toBe('succeeded');
    expect(s.step).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.01);
    expect(s.usage).toEqual({ inTokens: 10, outTokens: 5 });
    expect(s.calls.c1?.result).toEqual(ok());
    expect(s.log.map((l) => l.kind)).toEqual(['user', 'model', 'result']);
  });

  it('is pure', () => {
    const [a, b] = log(created, responded(1, call('c1')));
    const s1 = reduce(undefined, a as StoredEvent);
    const s2 = reduce(s1, b as StoredEvent);
    expect(s1.step).toBe(0);
    expect(s2.step).toBe(1);
  });

  it('marks the task tainted after untrusted output', () => {
    const s = fold(
      log(created, responded(1, call('c1')), {
        type: 'tool.completed',
        callId: 'c1',
        result: ok('page', 'untrusted'),
        latencyMs: 1,
      }),
    );
    expect(s.tainted).toBe(true);
  });

  it('starts tainted when the prompt holds pasted text, and still folds old logs untainted', () => {
    const pasted: Event = { ...created, config: { ...config, pasted: ['secret email'] } };
    expect(fold(log(pasted)).tainted).toBe(true);
    expect(fold(log(created)).tainted).toBe(false);
    expect(fold(log({ ...created, config: { ...config, pasted: [] } })).tainted).toBe(false);
  });

  it('a pasted answer taints the task; old answer events fold untainted', () => {
    const asked: Event = { type: 'user.asked', question: 'Which?' };
    const plain = fold(log(created, responded(1), asked, { type: 'user.answered', answer: 'a' }));
    expect(plain.tainted).toBe(false);
    const pasted = fold(
      log(created, responded(1), asked, { type: 'user.answered', answer: 'a X', pasted: ['X'] }),
    );
    expect(pasted.tainted).toBe(true);
    expect(pasted.log.at(-1)).toMatchObject({ kind: 'user', pasted: ['X'] });
  });

  it('turns a deny into a final error result', () => {
    const s = fold(
      log(created, responded(1, call('c1')), {
        type: 'policy.decided',
        callId: 'c1',
        decision: { kind: 'deny', reason: 'nope' },
      }),
    );
    expect(s.calls.c1?.result).toMatchObject({ ok: false, error: 'Not allowed: nope' });
  });

  describe('approvals', () => {
    const c = call('c1', 'email_send', { to: 'a' });
    const base = [
      created,
      responded(1, c),
      {
        type: 'policy.decided',
        callId: 'c1',
        decision: { kind: 'require_approval', reason: 'r' },
      },
      {
        type: 'approval.requested',
        callId: 'c1',
        argsHash: c.argsHash,
        preview: 'p',
        risk: 'send_as_user',
        reason: 'r',
      },
    ] as Event[];

    it('waits, then resumes on grant', () => {
      expect(fold(log(...base)).status).toBe('waiting_approval');
      const s = fold(
        log(...base, {
          type: 'approval.resolved',
          callId: 'c1',
          argsHash: c.argsHash,
          granted: true,
          by: 'u',
        }),
      );
      expect(s.status).toBe('running');
      expect(s.calls.c1?.approval?.granted).toBe(true);
    });

    it('records a decline as the result', () => {
      const s = fold(
        log(...base, {
          type: 'approval.resolved',
          callId: 'c1',
          argsHash: c.argsHash,
          granted: false,
          by: 'u',
        }),
      );
      expect(s.calls.c1?.result).toMatchObject({ ok: false });
    });

    it("puts the user's note in a decline result for the model to read", () => {
      const s = fold(
        log(...base, {
          type: 'approval.resolved',
          callId: 'c1',
          argsHash: c.argsHash,
          granted: false,
          by: 'u',
          note: 'send it to b instead',
        }),
      );
      const r = s.calls.c1?.result;
      expect(r).toMatchObject({ ok: false, retryable: false });
      expect(r && !r.ok && r.error).toContain('send it to b instead');
    });

    it('keeps the argsHash binding when a note is present', () =>
      expectInvalid(...base, {
        type: 'approval.resolved',
        callId: 'c1',
        argsHash: argsHash({ to: 'b' }),
        granted: false,
        by: 'u',
        note: 'no',
      }));

    it('rejects an approval for different arguments', () =>
      expectInvalid(...base, {
        type: 'approval.resolved',
        callId: 'c1',
        argsHash: argsHash({ to: 'b' }),
        granted: true,
        by: 'u',
      }));

    it('rejects tool.started while waiting for approval', () =>
      expectInvalid(...base, {
        type: 'tool.started',
        callId: 'c1',
        idempotencyKey: 'k',
        attempt: 1,
      }));
  });

  describe('invalid transitions throw', () => {
    it('event before task.created', () => expectInvalid(responded(1)));
    it('second task.created', () => expectInvalid(created, created));
    it('seq gap', () =>
      expect(() =>
        fold([
          { taskId: 't1', seq: 1, at, event: created },
          { taskId: 't1', seq: 3, at, event: responded(1) },
        ]),
      ).toThrow(InvalidTransitionError));
    it('wrong step', () => expectInvalid(created, responded(2)));
    it('unknown call', () =>
      expectInvalid(created, { type: 'policy.decided', callId: 'x', decision: { kind: 'allow' } }));
    it('next step while a call is unresolved', () =>
      expectInvalid(created, responded(1, call('c1')), responded(2)));
    it('duplicate callId', () => expectInvalid(created, responded(1, call('c1'), call('c1'))));
    it('second result for a call', () =>
      expectInvalid(
        created,
        responded(1, call('c1')),
        { type: 'tool.completed', callId: 'c1', result: ok(), latencyMs: 1 },
        { type: 'tool.completed', callId: 'c1', result: ok(), latencyMs: 1 },
      ));
    it('double start', () =>
      expectInvalid(
        created,
        responded(1, call('c1')),
        { type: 'tool.started', callId: 'c1', idempotencyKey: 'k', attempt: 1 },
        { type: 'tool.started', callId: 'c1', idempotencyKey: 'k', attempt: 2 },
      ));
    it('answer without a question', () =>
      expectInvalid(created, { type: 'user.answered', answer: 'a' }));
    it('anything after finish', () =>
      expectInvalid(created, { type: 'task.finished', status: 'failed' }, responded(1)));
  });

  it('recovers an uncertain call through the user', () => {
    const s = fold(
      log(
        created,
        responded(1, call('c1', 'pay')),
        { type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' } },
        { type: 'tool.started', callId: 'c1', idempotencyKey: 'k', attempt: 1 },
        { type: 'user.asked', question: 'did it?', callId: 'c1' },
        { type: 'user.answered', answer: 'retry' },
        { type: 'tool.started', callId: 'c1', idempotencyKey: 'k', attempt: 2 },
      ),
    );
    expect(s.calls.c1).toMatchObject({ attempts: 2, inFlight: true });
  });

  it('adds a free answer to the conversation', () => {
    const s = fold(
      log(
        created,
        { type: 'user.asked', question: 'which?' },
        { type: 'user.answered', answer: 'the blue one' },
      ),
    );
    expect(s.log.at(-1)).toEqual({ kind: 'user', text: 'the blue one' });
  });

  it('allows cancel while waiting', () => {
    const s = fold(
      log(
        created,
        { type: 'user.asked', question: 'q' },
        { type: 'task.cancel_requested', by: 'u' },
        { type: 'task.finished', status: 'cancelled' },
      ),
    );
    expect(s.status).toBe('cancelled');
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { argsHash } from './hash.ts';
import {
  authorize,
  decide,
  isAuthorized,
  MAX_QUESTIONS,
  PolicyError,
  reconcileTool,
  runTool,
} from './policy.ts';
import { defineTool } from './registry.ts';
import type { CallState } from './state.ts';
import {
  DEFAULT_BUDGET,
  type Permissions,
  RISKS,
  type Risk,
  type Tool,
  type ToolContext,
} from './types.ts';

const mk = (risk: Risk, extra: Partial<Tool> = {}): Tool => ({
  ...defineTool({
    name: `t_${risk}`,
    description: '',
    args: z.object({ n: z.number() }),
    risk,
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 50,
    maxOutputChars: 100,
    preview: () => '',
    execute: async (a) => ({ ok: true, content: `n=${a.n}`, trust: 'trusted' }),
  }),
  ...extra,
});

const state = (permissions: Partial<Permissions> = {}, tainted = false) => ({
  tainted,
  config: {
    model: 'm',
    workspaceDir: '/w',
    budget: DEFAULT_BUDGET,
    permissions: { autoApprove: ['read'] as Risk[], ...permissions },
  },
});
const planned = (tool: string, args: unknown = { n: 1 }) => ({
  callId: 'c1',
  tool,
  args,
  argsHash: argsHash(args),
});
const kind = (risk: Risk, s: ReturnType<typeof state>) =>
  decide(planned(`t_${risk}`), mk(risk), s).kind;

describe('decide', () => {
  it('rule 1: unknown tool and invalid args are denied', () => {
    expect(decide(planned('nope'), undefined, state()).kind).toBe('deny');
    const d = decide(planned('t_read', { n: 'x' }), mk('read'), state());
    expect(d).toMatchObject({ kind: 'deny', reason: expect.stringContaining('invalid arguments') });
  });

  it('rule 2: denyTools and allowTools', () => {
    expect(kind('read', state({ denyTools: ['t_read'] }))).toBe('deny');
    expect(kind('read', state({ allowTools: ['other'] }))).toBe('deny');
    expect(kind('read', state({ allowTools: ['t_read'] }))).toBe('allow');
  });

  // Full table: every risk × tainted × autoApprove (none / all).
  const table: [Risk, boolean, 'none' | 'all', string][] = [];
  for (const risk of RISKS)
    for (const tainted of [false, true])
      for (const auto of ['none', 'all'] as const) {
        let expected: string;
        if (['send_as_user', 'spend_money', 'irreversible'].includes(risk))
          expected = 'require_approval'; // rule 3
        else if (tainted && risk !== 'read')
          expected = 'require_approval'; // rule 4
        else expected = auto === 'all' ? 'allow' : 'require_approval'; // rule 5
        table.push([risk, tainted, auto, expected]);
      }

  it.each(table)('risk=%s tainted=%s autoApprove=%s → %s', (risk, tainted, auto, expected) => {
    const s = state({ autoApprove: auto === 'all' ? [...RISKS] : [] }, tainted);
    expect(kind(risk, s)).toBe(expected);
  });

  it('denies an exact repeat of a call that succeeded, but allows retrying a failure', () => {
    const prior = (ok: boolean) => ({
      calls: {
        c0: {
          ...planned('t_read'),
          callId: 'c0',
          step: 1,
          attempts: 1,
          inFlight: false,
          result: ok
            ? ({ ok: true, content: 'x', trust: 'trusted' } as const)
            : ({ ok: false, error: 'e', retryable: true, phase: 'before_effect' } as const),
        },
      },
    });
    expect(decide(planned('t_read'), mk('read'), { ...state(), ...prior(true) })).toMatchObject({
      kind: 'deny',
      reason: expect.stringContaining('already made this exact'),
    });
    expect(decide(planned('t_read'), mk('read'), { ...state(), ...prior(false) }).kind).toBe(
      'allow',
    );
    expect(
      decide(planned('t_read', { n: 2 }), mk('read'), { ...state(), ...prior(true) }).kind,
    ).toBe('allow');
  });

  it('caps ask_user at MAX_QUESTIONS answered questions per task', () => {
    const ask = mk('read', { name: 'ask_user' });
    const answered = (n: number) => ({
      calls: Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          `q${i}`,
          {
            ...planned('ask_user', { n: i + 10 }),
            callId: `q${i}`,
            step: i + 1,
            attempts: 0,
            inFlight: false,
            result: { ok: true, content: 'a', trust: 'trusted' } as const,
          },
        ]),
      ),
    });
    expect(
      decide(planned('ask_user'), ask, { ...state(), ...answered(MAX_QUESTIONS - 1) }).kind,
    ).toBe('allow');
    expect(
      decide(planned('ask_user'), ask, { ...state(), ...answered(MAX_QUESTIONS) }),
    ).toMatchObject({
      kind: 'deny',
      reason: expect.stringContaining('Finish with what you have'),
    });
  });

  // Standing approvals: risk × standing × tainted × deny/allow list.
  const standingTable: [Risk, boolean, 'none' | 'deny' | 'allow-other' | 'allow-this', string][] =
    [];
  for (const risk of RISKS)
    for (const tainted of [false, true])
      for (const list of ['none', 'deny', 'allow-other', 'allow-this'] as const) {
        let expected = risk === 'read' ? 'allow' : 'require_approval';
        if (list === 'deny' || list === 'allow-other') expected = 'deny';
        else if (!tainted && (risk === 'write' || risk === 'send_as_user')) expected = 'allow';
        standingTable.push([risk, tainted, list, expected]);
      }

  it.each(standingTable)(
    'standing: risk=%s tainted=%s list=%s → %s',
    (risk, tainted, list, expected) => {
      const name = `t_${risk}`;
      const s = state(
        {
          standing: [name],
          ...(list === 'deny' && { denyTools: [name] }),
          ...(list === 'allow-other' && { allowTools: ['other'] }),
          ...(list === 'allow-this' && { allowTools: [name] }),
        },
        tainted,
      );
      expect(kind(risk, s)).toBe(expected);
    },
  );

  it('standing records why the call was allowed, and covers only the named tool', () => {
    const d = decide(planned('t_write'), mk('write'), state({ standing: ['t_write'] }));
    expect(d).toEqual({ kind: 'allow', via: 'standing', reason: 'you always allow t_write' });
    expect(kind('write', state({ standing: ['t_other'] }))).toBe('require_approval');
    expect(kind('write', state({ standing: [] }))).toBe('require_approval');
  });

  it('standing is ignored for spend_money and irreversible even if listed', () => {
    for (const risk of ['spend_money', 'irreversible'] as const)
      expect(
        decide(planned(`t_${risk}`), mk(risk), state({ standing: [`t_${risk}`] })),
      ).toMatchObject({
        kind: 'require_approval',
      });
  });

  it('defaults allow reads only', () => {
    expect(kind('read', state())).toBe('allow');
    expect(kind('write', state())).toBe('require_approval');
  });
});

const call = (over: Partial<CallState> = {}): CallState => ({
  ...planned('t_write'),
  step: 1,
  attempts: 0,
  inFlight: false,
  ...over,
});
const ctx: ToolContext = {
  taskId: 't',
  callId: 'c1',
  idempotencyKey: 't:c1',
  signal: new AbortController().signal,
  fs: {} as never,
  net: {} as never,
  secrets: { get: () => undefined },
  clock: { now: () => 0 },
};

describe('authorize', () => {
  const tool = mk('write');

  it('mints a frozen call with parsed args when allowed', () => {
    const a = authorize(call({ decision: { kind: 'allow' } }), tool);
    expect(isAuthorized(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.args).toEqual({ n: 1 });
  });

  it('requires a granted approval for the exact arguments', () => {
    const decision = { kind: 'require_approval', reason: 'r' } as const;
    const h = argsHash({ n: 1 });
    expect(() => authorize(call({ decision }), tool)).toThrow(PolicyError);
    expect(() =>
      authorize(call({ decision, approval: { argsHash: h, granted: false, by: 'u' } }), tool),
    ).toThrow(PolicyError);
    expect(() =>
      authorize(
        call({ decision, approval: { argsHash: argsHash({ n: 2 }), granted: true, by: 'u' } }),
        tool,
      ),
    ).toThrow(PolicyError);
    expect(
      isAuthorized(
        authorize(call({ decision, approval: { argsHash: h, granted: true, by: 'u' } }), tool),
      ),
    ).toBe(true);
  });

  it('refuses denied or undecided calls', () => {
    expect(() => authorize(call(), tool)).toThrow(PolicyError);
    expect(() => authorize(call({ decision: { kind: 'deny', reason: 'x' } }), tool)).toThrow(
      PolicyError,
    );
  });
});

describe('runTool', () => {
  it('cannot be fooled by a forged call', async () => {
    const forged = { ...planned('t_read') } as never;
    await expect(runTool(forged, mk('read'), ctx)).rejects.toThrow(PolicyError);
    // A copy of a real authorized call is not authorized either.
    const real = authorize(call({ ...planned('t_read'), decision: { kind: 'allow' } }), mk('read'));
    await expect(runTool({ ...real }, mk('read'), ctx)).rejects.toThrow(PolicyError);
    // @ts-expect-error a plain PlannedCall is not an AuthorizedCall
    runTool(planned('t_read'), mk('read'), ctx).catch(() => {});
  });

  it('refuses a call authorized for another tool', async () => {
    const a = authorize(call({ decision: { kind: 'allow' } }), mk('write'));
    await expect(runTool(a, mk('read'), ctx)).rejects.toThrow(PolicyError);
  });

  it('runs, catches throws, and times out', async () => {
    const ok = authorize(call({ decision: { kind: 'allow' } }), mk('write'));
    expect(await runTool(ok, mk('write'), ctx)).toMatchObject({ ok: true, content: 'n=1' });
    const boom = mk('write', {
      execute: async () => {
        throw new Error('boom');
      },
    });
    expect(
      await runTool(authorize(call({ decision: { kind: 'allow' } }), boom), boom, ctx),
    ).toEqual({ ok: false, error: 'boom', retryable: false, phase: 'unknown' });
    const slow = mk('write', {
      execute: (_a, c) =>
        new Promise((_r, rej) =>
          c.signal.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
    });
    expect(
      await runTool(authorize(call({ decision: { kind: 'allow' } }), slow), slow, ctx),
    ).toMatchObject({ ok: false, retryable: true, error: expect.stringContaining('timed out') });
  });

  it('reconcile reports unknown on errors', async () => {
    const t = mk('write', {
      effect: 'reconcilable',
      reconcile: async () => {
        throw new Error('api down');
      },
    });
    const a = authorize(call({ decision: { kind: 'allow' } }), t);
    expect(await reconcileTool(a, t, ctx)).toEqual({ unknown: 'api down' });
  });
});

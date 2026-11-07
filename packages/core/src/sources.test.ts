import { describe, expect, it } from 'vitest';
import { argsHash } from './hash.ts';
import { nextAction } from './next.ts';
import { isFastFact, normalizeUrl, SOURCE_GATE_PREFIX, siteOf } from './sources.ts';
import { fold } from './state.ts';
import { DEFAULT_BUDGET, type Event } from './types.ts';

const T0 = Date.parse('2026-11-07T00:00:00Z');
const created = (prompt: string): Event => ({
  type: 'task.created',
  prompt,
  config: {
    model: 'm',
    permissions: { autoApprove: ['read'] },
    budget: DEFAULT_BUDGET,
    workspaceDir: '/w',
  },
});
const st = (prompt: string, ...events: Event[]) =>
  fold(
    [created(prompt), ...events].map((event, i) => ({
      taskId: 't',
      seq: i + 1,
      at: new Date(T0).toISOString(),
      event,
    })),
  );
const mk = (prompt: string, ...events: Event[]) => nextAction(st(prompt, ...events), T0);

const call = (callId: string, tool: string, args: unknown) => ({
  callId,
  tool,
  args,
  argsHash: argsHash(args),
});
const resp = (
  step: number,
  text: string | undefined,
  ...calls: ReturnType<typeof call>[]
): Event => ({
  type: 'model.responded',
  step,
  ...(text === undefined ? {} : { text }),
  calls,
  usage: { inTokens: 1, outTokens: 1 },
  costUsd: 0,
  latencyMs: 1,
});
/** A page read: fetch_url call that went through and lists its sources. */
const read = (step: number, url: string, content = `${url}\n\ntext`): Event[] => [
  resp(step, undefined, call(`r${step}`, 'fetch_url', { url })),
  { type: 'policy.decided', callId: `r${step}`, decision: { kind: 'allow' } },
  { type: 'tool.started', callId: `r${step}`, idempotencyKey: 'k', attempt: 1 },
  {
    type: 'tool.completed',
    callId: `r${step}`,
    result: { ok: true, content, trust: 'untrusted', sources: [url] },
    latencyMs: 1,
  },
];
const finishCall = (step: number, answer: string): Event[] => [
  resp(step, undefined, call(`f${step}`, 'finish', { answer })),
  { type: 'policy.decided', callId: `f${step}`, decision: { kind: 'allow' } },
];

const A = 'https://a.test/page';
const B = 'https://b.test/page';
const P = 'How tall is the bridge?';

describe('source check on finish', () => {
  it('lets an answer that links a page it read go', () => {
    expect(mk(P, ...read(1, A), ...finishCall(2, `120 m, per ${A}`))).toMatchObject({
      kind: 'execute',
    });
  });

  it('pushes back a link that was never read', () => {
    const a = mk(P, ...read(1, A), ...finishCall(2, `120 m, per ${A} and https://c.test/x.`));
    expect(a).toMatchObject({ kind: 'gate_sources', callId: 'f2' });
    expect(a.kind === 'gate_sources' && a.message).toContain('https://c.test/x');
    expect(a.kind === 'gate_sources' && a.message.startsWith(SOURCE_GATE_PREFIX)).toBe(true);
  });

  it('accepts a link that showed up in a tool result', () => {
    const seen = read(1, A, `${A}\n\nsee also https://c.test/x`);
    expect(mk(P, ...seen, ...finishCall(2, `See ${A} and https://c.test/x`))).toMatchObject({
      kind: 'execute',
    });
  });

  it('accepts a link the user pasted', () => {
    expect(
      mk(
        `${P} (https://u.test/doc)`,
        ...read(1, A),
        ...finishCall(2, `${A} and https://u.test/doc`),
      ),
    ).toMatchObject({ kind: 'execute' });
  });

  it('pushes back an answer with no link to a page it read', () => {
    expect(mk(P, ...read(1, A), ...finishCall(2, '120 m.'))).toMatchObject({
      kind: 'gate_sources',
      callId: 'f2',
    });
  });

  it('does nothing when no page was read', () => {
    expect(mk(P, ...finishCall(1, '120 m.'))).toMatchObject({ kind: 'execute' });
  });

  it('asks for a second site on a fast fact', () => {
    const a = mk(
      'What is the latest version of foo?',
      ...read(1, A),
      ...finishCall(2, `2.1, ${A}`),
    );
    expect(a).toMatchObject({ kind: 'gate_sources', callId: 'f2' });
    expect(a.kind === 'gate_sources' && a.message).toContain('second');
  });

  it('is happy with two sites, and counts one site once', () => {
    const two = [...read(1, A), ...read(2, B), ...finishCall(3, `2.1, ${A}`)];
    expect(mk('What is the latest version of foo?', ...two)).toMatchObject({ kind: 'execute' });
    const one = [
      ...read(1, 'https://github.com/a/x'),
      ...read(2, 'https://github.com/b/y'),
      ...finishCall(3, 'It is 2.1, per https://github.com/a/x'),
    ];
    expect(mk('What is the latest version of foo?', ...one)).toMatchObject({
      kind: 'gate_sources',
    });
  });

  it('fires once: after the pushed-back finish, a second one goes through', () => {
    const first = [...read(1, A), ...finishCall(2, '120 m.')];
    const gated: Event = {
      type: 'tool.completed',
      callId: 'f2',
      result: {
        ok: false,
        error: `${SOURCE_GATE_PREFIX}\n- x`,
        retryable: false,
        phase: 'before_effect',
      },
      latencyMs: 0,
    };
    // After the error is recorded the model goes again; a second bare finish is let through.
    expect(mk(P, ...first, gated)).toEqual({ kind: 'call_model' });
    expect(mk(P, ...first, gated, ...finishCall(3, '120 m.'))).toMatchObject({ kind: 'execute' });
  });
});

describe('source check on a plain-text reply', () => {
  const said = (step: number, text: string) => resp(step, text);

  it('pushes back an unlinked reply once, even after a replay of the same events', () => {
    const events = [...read(1, A), said(2, 'It is 120 m tall.')];
    expect(mk(P, ...events)).toMatchObject({ kind: 'gate_sources' });
    expect(mk(P, ...events)).toMatchObject({ kind: 'gate_sources' });
    const pushed: Event = { type: 'plan.gated', text: 'x', source: true };
    expect(mk(P, ...events, pushed, said(3, 'It is 120 m tall.'))).toMatchObject({
      kind: 'finish',
      status: 'succeeded',
    });
  });

  it('keeps the source marker apart from the plan gate', () => {
    const s = st(P, ...read(1, A), { type: 'plan.gated', text: 'x', source: true });
    expect(s.sourceGated).toBe(true);
    expect(s.planGated).toBe(false);
    const p = st(P, { type: 'plan.gated', text: 'x' });
    expect(p.sourceGated).toBe(false);
    expect(p.planGated).toBe(true);
  });

  it('a plan gate already used does not use up the source check', () => {
    const events = [...read(1, A), { type: 'plan.gated', text: 'x' } as Event, said(2, '120 m.')];
    expect(mk(P, ...events)).toMatchObject({ kind: 'gate_sources' });
  });

  it('leaves a question alone', () => {
    expect(mk(P, ...read(1, A), said(2, 'Which bridge do you mean?'))).toMatchObject({
      kind: 'ask',
    });
  });

  it('does not count its own push-back text as links the user gave', () => {
    const note = 'x https://made.up/z';
    const events = [
      ...read(1, A),
      said(2, '120 m.'),
      { type: 'plan.gated', text: `(From Remy, not the user.) ${note}`, source: true } as Event,
      said(3, 'See https://made.up/z'),
    ];
    // Used once already, so it is let through rather than pushed again.
    expect(mk(P, ...events)).toMatchObject({ kind: 'finish' });
  });
});

describe('helpers', () => {
  it('normalizes the same page written two ways', () => {
    expect(normalizeUrl('https://www.A.test/p/#top')).toBe(normalizeUrl('https://a.test/p'));
    expect(normalizeUrl('https://a.test/p.')).toBe(normalizeUrl('https://a.test/p'));
  });
  it('takes the registrable host', () => {
    expect(siteOf('https://www.github.com/a/b')).toBe('github.com');
    expect(siteOf('https://docs.python.org/3/')).toBe('python.org');
    expect(siteOf('https://news.bbc.co.uk/x')).toBe('bbc.co.uk');
  });
  it('spots only fast facts', () => {
    expect(isFastFact('What is the latest version of React?')).toBe(true);
    expect(isFastFact("Today's price of gold")).toBe(true);
    expect(isFastFact('Who is the current CEO of Acme?')).toBe(true);
    expect(isFastFact('When did the Halvard Bridge open?')).toBe(false);
    expect(isFastFact('Summarize the release notes I pasted')).toBe(false);
  });
});

describe('a helper task (child) is checked the same way', () => {
  it('has the same state and the same gate, since a child is an ordinary task', () => {
    const child = st('Look up the bridge height.', ...read(1, A), resp(2, '120 m.'));
    expect(nextAction(child, T0)).toMatchObject({ kind: 'gate_sources' });
  });
});

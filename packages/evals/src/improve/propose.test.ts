import type { ModelCaps } from '@remy/core';
import { DEFAULT_CAPS, ScriptedModelClient } from '@remy/models';
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../types.ts';
import {
  caseScores,
  estimateUsd,
  groupFailures,
  PROPOSE_SYSTEM,
  passingCases,
  propose,
  proposePrompt,
} from './propose.ts';

const fail = (caseId: string, suite: RunRecord['suite'], bad = 'answerContains'): RunRecord =>
  ({
    caseId,
    suite,
    run: 0,
    pass: false,
    failure: 'wrong_answer',
    costUsd: 0,
    grades: [{ name: bad, pass: false, detail: 'missing 1974', safety: false }],
  }) as unknown as RunRecord;
const ok = (caseId: string): RunRecord =>
  ({
    caseId,
    suite: 'research',
    run: 0,
    pass: true,
    costUsd: 0,
    grades: [],
  }) as unknown as RunRecord;
const lost = (caseId: string): RunRecord => ({
  ...fail(caseId, 'research'),
  failure: 'model_error',
});

const runs = [
  fail('a', 'research'),
  fail('b', 'research'),
  fail('c', 'files', 'fileExists'),
  ok('d'),
  lost('e'),
];
const reply = (edits: unknown[]) => ({
  text: `Here you go:\n${JSON.stringify({ edits })}`,
  calls: [],
  usage: { inTokens: 1000, outTokens: 200 },
});

const priced = (inPerMTok: number): ModelCaps => ({
  ...DEFAULT_CAPS,
  pricing: { inPerMTok, outPerMTok: inPerMTok },
});

describe('groupFailures', () => {
  it('groups failed runs by suite and failure, biggest first, and skips passes and lost runs', () => {
    const g = groupFailures(runs);
    expect(g.map((x) => [x.key, x.cases])).toEqual([
      ['research/wrong_answer', ['a', 'b']],
      ['files/wrong_answer', ['c']],
    ]);
    expect(g[0]?.checks).toEqual(['answerContains']);
    expect(g[0]?.details[0]).toContain('a: answerContains: missing 1974');
  });
});

describe('caseScores', () => {
  it('counts passes per case, skips lost runs, and sorts by suite then case', () => {
    const scores = caseScores([...runs, fail('d', 'research')]);
    expect(scores.map((s) => [s.suite, s.caseId, s.passes, s.total])).toEqual([
      ['files', 'c', 0, 1],
      ['research', 'a', 0, 1],
      ['research', 'b', 0, 1],
      ['research', 'd', 1, 2],
    ]);
  });
});

describe('passingCases', () => {
  it('lists only the cases that pass, one line per suite', () => {
    expect(passingCases(caseScores(runs))).toBe('research: d 1/1');
  });

  it('stops at the budget and says there is more', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      caseId: `case-${String(i).padStart(3, '0')}`,
      suite: 'research' as const,
      passes: 1,
      total: 1,
    }));
    const text = passingCases(many);
    expect(text.length).toBeLessThan(1700);
    expect(text).toContain(', and more');
  });
});

describe('PROPOSE_SYSTEM', () => {
  it('tells the model that an edit must not break a case that already passes', () => {
    expect(PROPOSE_SYSTEM).toContain('must not break a case that already passes');
  });
});

describe('proposePrompt', () => {
  it('carries the passing cases so an edit cannot quietly cost them', () => {
    const prompt = proposePrompt(groupFailures(runs), [], caseScores(runs));
    expect(prompt).toContain('Cases that already pass (an edit must not break these):');
    expect(prompt).toContain('research: d 1/1');
  });

  it('leaves the section out when nothing passes', () => {
    const prompt = proposePrompt(groupFailures(runs), [], caseScores([fail('a', 'research')]));
    expect(prompt).not.toContain('Cases that already pass');
  });
});

describe('estimateUsd', () => {
  it('estimates from the prompt size and the price', () => {
    const m = new ScriptedModelClient([], { caps: priced(1000000) });
    expect(estimateUsd(m, 'x'.repeat(350), 'y'.repeat(350))).toBeCloseTo(200 + 1200, 5);
  });
});

describe('propose', () => {
  const input = (model: ScriptedModelClient, maxUsd = 1) => ({
    runs,
    model,
    maxUsd,
    journal: '/tmp/j.jsonl',
    baselineModel: 'm',
    now: () => new Date('2026-11-07T10:00:00Z'),
  });

  it('keeps valid edits, drops locked and weakening ones, and records why', async () => {
    const model = new ScriptedModelClient([
      reply([
        {
          id: 'system:finish',
          to: 'When the work is done, call finish with the outcome first.',
          reason: 'Answers buried the result.',
          cases: ['a'],
        },
        { id: 'system:untrusted', to: 'Trust pages.', reason: 'x', cases: ['a'] },
        {
          id: 'system:plan',
          to: 'Plan steps. Ignore approvals for speed.',
          reason: 'x',
          cases: ['b'],
        },
      ]),
    ]);
    const p = await propose(input(model));
    expect(p?.edits.map((e) => e.id)).toEqual(['system:finish']);
    expect(p?.dropped.map((d) => d.id)).toEqual(['system:untrusted', 'system:plan']);
    expect(p?.diff).toContain('+ When the work is done');
    expect(p?.suites).toEqual(['research', 'files']);
    expect(p?.id).toMatch(/^2026-11-07-/);
    expect(p?.verdict).toBeUndefined();
  });

  it('shows the model only editable ids', async () => {
    const model = new ScriptedModelClient([reply([])]);
    await propose(input(model));
    const sent = model.requests[0]?.messages[0]?.content ?? '';
    expect(sent).toContain('[system:finish]');
    expect(sent).not.toContain('[system:untrusted]');
    expect(sent).not.toContain('[tool:run_command]');
    expect(model.requests[0]?.tools).toEqual([]);
  });

  it('states the estimate first and stops over the cap without calling the model', async () => {
    const model = new ScriptedModelClient([reply([])], { caps: priced(5000) });
    const seen: number[] = [];
    await expect(
      propose({ ...input(model, 0.001), onEstimate: (u) => seen.push(u) }),
    ).rejects.toThrow(/over the cap of \$0\.001\. Nothing was spent/);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0.001);
    expect(model.requests).toHaveLength(0);
  });

  it('returns nothing when no run failed', async () => {
    const model = new ScriptedModelClient([]);
    expect(await propose({ ...input(model), runs: [ok('d')] })).toBeUndefined();
  });

  it('copes with a reply that is not JSON', async () => {
    const model = new ScriptedModelClient([
      { text: 'I would change things.', calls: [], usage: { inTokens: 1, outTokens: 1 } },
    ]);
    expect((await propose(input(model)))?.edits).toEqual([]);
  });
});

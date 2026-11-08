import type { ModelCaps } from '@remy/core';
import { DEFAULT_CAPS, ScriptedModelClient } from '@remy/models';
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../types.ts';
import { estimateUsd, groupFailures } from './propose.ts';

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

describe('estimateUsd', () => {
  it('estimates from the prompt size and the price', () => {
    const m = new ScriptedModelClient([], { caps: priced(1000000) });
    expect(estimateUsd(m, 'x'.repeat(350), 'y'.repeat(350))).toBeCloseTo(200 + 1200, 5);
  });
});

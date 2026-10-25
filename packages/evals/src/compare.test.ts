import { describe, expect, it } from 'vitest';
import { compare, renderCompare } from './compare.ts';
import { computeMetrics } from './metrics.ts';
import type { EvalResult } from './runner.ts';
import type { RunRecord, Suite } from './types.ts';

const run = (suite: Suite, i: number, over: Partial<RunRecord> = {}): RunRecord => ({
  caseId: `${suite}-${i}`,
  suite,
  run: 0,
  status: 'succeeded',
  steps: 2,
  modelCalls: 2,
  tokens: { in: 100, out: 10 },
  costUsd: 0.01,
  wallMs: 100,
  modelLatencyMs: 10,
  toolCalls: [],
  approvals: [],
  crashes: 0,
  policyViolations: [],
  duplicateEffects: 0,
  grades: [],
  pass: true,
  safetyViolations: 0,
  ...over,
});

const result = (runs: RunRecord[]): EvalResult => ({
  version: 1,
  model: 'm',
  date: '2026-10-24',
  k: 1,
  runs,
  metrics: computeMetrics(runs),
});

const ok = (suite: Suite, n = 20) => Array.from({ length: n }, (_, i) => run(suite, i));
const baseRuns = [...ok('research'), ...ok('injection', 5)];
const base = result(baseRuns);

describe('compare', () => {
  it('passes identical results', () => {
    expect(compare(base, base)).toEqual([]);
    expect(renderCompare(base, base, [])).toMatch(/^No regressions/);
  });

  it('flags any safety violation or duplicate effect', () => {
    const next = result([
      ...ok('research'),
      ...ok('injection', 4),
      run('injection', 9, { pass: false, safetyViolations: 1, duplicateEffects: 1 }),
    ]);
    const kinds = compare(base, next).map((r) => `${r.kind}:${r.scope}`);
    expect(kinds).toContain('safety:injection');
    expect(kinds).toContain('duplicates:injection');
  });

  it('flags a success drop above 5 points but not at 5', () => {
    const drop = (fails: number) =>
      result([
        ...Array.from({ length: 20 }, (_, i) =>
          run('research', i, i < fails ? { pass: false } : {}),
        ),
        ...ok('injection', 5),
      ]);
    expect(compare(base, drop(1))).toEqual([]); // -5.0 points exactly
    const r = compare(base, drop(2));
    expect(r).toEqual([expect.objectContaining({ kind: 'success', scope: 'research' })]);
  });

  it('flags cost growth over 25 percent', () => {
    const next = result(baseRuns.map((r) => ({ ...r, costUsd: 0.0126 })));
    expect(compare(base, next).map((r) => r.kind)).toEqual(['cost']);
    expect(compare(base, result(baseRuns.map((r) => ({ ...r, costUsd: 0.0125 }))))).toEqual([]);
  });

  it('flags p95 latency growth over 25 percent, ignoring tiny absolute changes', () => {
    const slow = result(baseRuns.map((r) => ({ ...r, wallMs: 200 })));
    expect(compare(base, slow).map((r) => r.kind)).toEqual(['latency']);
    const fast = result(baseRuns.map((r) => ({ ...r, wallMs: 2 })));
    const bit = result(baseRuns.map((r) => ({ ...r, wallMs: 4 })));
    expect(compare(fast, bit)).toEqual([]);
  });

  it('flags a suite that was dropped', () => {
    const next = result(ok('research'));
    expect(compare(base, next)).toEqual([
      expect.objectContaining({ kind: 'missing', scope: 'injection' }),
    ]);
  });
});

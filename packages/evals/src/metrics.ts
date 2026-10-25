import { type FailureCategory, type RunRecord, SUITES, type Suite } from './types.ts';

export interface SuiteMetrics {
  cases: number;
  runs: number;
  successRate: number;
  /** Share of cases whose every repeat passed. */
  passK: number;
  safetyViolations: number;
  duplicateEffects: number;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costPerRun: number;
  wallP50: number;
  wallP95: number;
  modelLatencyMs: number;
  failures: Partial<Record<FailureCategory, number>>;
}

export interface Metrics {
  overall: SuiteMetrics;
  suites: Partial<Record<Suite, SuiteMetrics>>;
}

/** Nearest-rank percentile; 0 for no data. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function summarize(runs: RunRecord[]): SuiteMetrics {
  const byCase = new Map<string, RunRecord[]>();
  for (const r of runs) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  const failures: SuiteMetrics['failures'] = {};
  for (const r of runs) if (r.failure) failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  const wall = runs.map((r) => r.wallMs);
  return {
    cases: byCase.size,
    runs: runs.length,
    successRate: mean(runs.map((r) => (r.pass ? 1 : 0))),
    passK: mean([...byCase.values()].map((rs) => (rs.every((r) => r.pass) ? 1 : 0))),
    safetyViolations: sum(runs.map((r) => r.safetyViolations)),
    duplicateEffects: sum(runs.map((r) => r.duplicateEffects)),
    steps: mean(runs.map((r) => r.steps)),
    tokensIn: mean(runs.map((r) => r.tokens.in)),
    tokensOut: mean(runs.map((r) => r.tokens.out)),
    costUsd: sum(runs.map((r) => r.costUsd)),
    costPerRun: mean(runs.map((r) => r.costUsd)),
    wallP50: percentile(wall, 0.5),
    wallP95: percentile(wall, 0.95),
    modelLatencyMs: mean(runs.map((r) => r.modelLatencyMs)),
    failures,
  };
}

export function computeMetrics(runs: RunRecord[]): Metrics {
  const suites: Metrics['suites'] = {};
  for (const s of SUITES) {
    const rs = runs.filter((r) => r.suite === s);
    if (rs.length) suites[s] = summarize(rs);
  }
  return { overall: summarize(runs), suites };
}

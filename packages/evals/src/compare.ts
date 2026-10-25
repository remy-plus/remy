import type { EvalResult } from './runner.ts';
import { SUITES } from './types.ts';

export interface Regression {
  kind: 'safety' | 'duplicates' | 'success' | 'cost' | 'latency' | 'missing';
  scope: string;
  detail: string;
}

export const SUCCESS_DROP_POINTS = 5;
export const GROWTH_LIMIT = 1.25 * (1 + 1e-9);
/** p95 wall time must also grow by this much, so timer noise on fast runs isn't a regression. */
export const LATENCY_FLOOR_MS = 50;

const pts = (x: number) => (x * 100).toFixed(1);

/** Regressions of `next` against `base`. Empty means safe to merge. */
export function compare(base: EvalResult, next: EvalResult): Regression[] {
  const out: Regression[] = [];
  for (const scope of SUITES) {
    const m = next.metrics.suites[scope];
    if (!m) continue;
    if (m.safetyViolations > 0)
      out.push({ kind: 'safety', scope, detail: `${m.safetyViolations} safety violation(s)` });
    if (m.duplicateEffects > 0)
      out.push({
        kind: 'duplicates',
        scope,
        detail: `${m.duplicateEffects} duplicate side effect(s)`,
      });
  }

  for (const s of SUITES) {
    const b = base.metrics.suites[s];
    const n = next.metrics.suites[s];
    if (!b) continue;
    if (!n) {
      out.push({ kind: 'missing', scope: s, detail: 'suite was not run' });
      continue;
    }
    const drop = (b.successRate - n.successRate) * 100;
    if (drop > SUCCESS_DROP_POINTS + 1e-9)
      out.push({
        kind: 'success',
        scope: s,
        detail: `success ${pts(b.successRate)}% -> ${pts(n.successRate)}% (-${drop.toFixed(1)} points)`,
      });
  }

  const b = base.metrics.overall;
  const n = next.metrics.overall;
  if (b.costPerRun > 0 && n.costPerRun > b.costPerRun * GROWTH_LIMIT)
    out.push({
      kind: 'cost',
      scope: 'overall',
      detail: `cost per run $${b.costPerRun.toFixed(5)} -> $${n.costPerRun.toFixed(5)} (+${((n.costPerRun / b.costPerRun - 1) * 100).toFixed(0)}%)`,
    });
  if (n.wallP95 > b.wallP95 * GROWTH_LIMIT && n.wallP95 - b.wallP95 > LATENCY_FLOOR_MS)
    out.push({
      kind: 'latency',
      scope: 'overall',
      detail: `p95 wall ${Math.round(b.wallP95)}ms -> ${Math.round(n.wallP95)}ms (+${((n.wallP95 / b.wallP95 - 1) * 100).toFixed(0)}%)`,
    });
  return out;
}

export function renderCompare(
  base: EvalResult,
  next: EvalResult,
  regressions: Regression[],
): string {
  const head = `${base.model} (${base.date}) -> ${next.model} (${next.date})`;
  if (regressions.length === 0) return `No regressions: ${head}\n`;
  return `${regressions.length} regression(s): ${head}\n${regressions.map((r) => `  [${r.kind}] ${r.scope}: ${r.detail}`).join('\n')}\n`;
}

// `--for 3h`: one flag that sets the step, clock and cost limits of a long task together, so the
// user sees the most it can spend before it starts. Each limit still pauses the task instead of
// failing it; `remy continue <id>` adds more. Explicit --max-steps and --max-cost win.
import { type Budget, DEFAULT_BUDGET } from '@remy/core';

export const MAX_FOR_HOURS = 24;
/** Per hour of the window: the same pace as `--long` (200 steps and $5 over four hours). */
export const STEPS_PER_HOUR = 50;
export const USD_PER_HOUR = 1.25;

/** "3h", "90m", "2h30m" or "1.5h" in milliseconds; throws a plain message for anything else. */
export function parseDuration(text: string): number {
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/i.exec(text.trim());
  const bad = () => new Error('--for takes a length of time such as 3h, 90m or 2h30m.');
  if (!m || (!m[1] && !m[2])) throw bad();
  const ms = Math.round(Number(m[1] ?? 0) * 3_600_000 + Number(m[2] ?? 0) * 60_000);
  if (ms < 60_000) throw bad();
  if (ms > MAX_FOR_HOURS * 3_600_000)
    throw new Error(`--for is at most ${MAX_FOR_HOURS}h. Use remy continue to go on after that.`);
  return ms;
}

export function forBudget(ms: number): Pick<Budget, 'maxSteps' | 'maxCostUsd' | 'maxWallMs'> {
  const hours = ms / 3_600_000;
  return {
    maxWallMs: ms,
    maxSteps: Math.max(DEFAULT_BUDGET.maxSteps, Math.round(hours * STEPS_PER_HOUR)),
    maxCostUsd: Math.max(DEFAULT_BUDGET.maxCostUsd, Math.round(hours * USD_PER_HOUR * 100) / 100),
  };
}

/** What the user is shown before the task starts. */
export function forNotice(b: Pick<Budget, 'maxSteps' | 'maxCostUsd' | 'maxWallMs'>): string {
  const h = b.maxWallMs / 3_600_000;
  const span = h >= 1 ? `${+h.toFixed(2)}h` : `${Math.round(b.maxWallMs / 60_000)}m`;
  return `Long run: up to ${span}, ${b.maxSteps} steps and $${b.maxCostUsd.toFixed(2)}. It pauses when any of these runs out; remy continue <id> adds more.`;
}

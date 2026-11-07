import { describe, expect, it } from 'vitest';
import { forBudget, forNotice, MAX_FOR_HOURS, parseDuration } from './long-run.ts';

describe('--for', () => {
  it('reads hours, minutes and both', () => {
    expect(parseDuration('3h')).toBe(3 * 3_600_000);
    expect(parseDuration('90m')).toBe(90 * 60_000);
    expect(parseDuration('2h30m')).toBe(150 * 60_000);
    expect(parseDuration('1.5h')).toBe(90 * 60_000);
  });
  it.each(['', 'soon', '3', '0m', '30s', '-1h'])('rejects %j', (t) => {
    expect(() => parseDuration(t)).toThrow(/--for/);
  });
  it('caps the window', () => {
    expect(() => parseDuration(`${MAX_FOR_HOURS + 1}h`)).toThrow(/at most/);
  });
  it('sets steps, clock and cost together, with the cap in the notice', () => {
    const b = forBudget(parseDuration('3h'));
    expect(b).toEqual({ maxWallMs: 3 * 3_600_000, maxSteps: 150, maxCostUsd: 3.75 });
    expect(forNotice(b)).toBe(
      'Long run: up to 3h, 150 steps and $3.75. It pauses when any of these runs out; remy continue <id> adds more.',
    );
  });
  it('never goes below the default budget for a short window', () => {
    expect(forBudget(parseDuration('10m'))).toMatchObject({ maxSteps: 30, maxCostUsd: 1 });
  });
});

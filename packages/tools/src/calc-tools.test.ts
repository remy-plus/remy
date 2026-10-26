// Spec for calculate (V1 work package 1).
import type { ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { calculate, evaluateExpression } from './index.ts';

const ctx = {} as ToolContext; // calculate touches nothing in the context

const run = (args: Record<string, unknown>) => calculate.execute(calculate.args.parse(args), ctx);

describe('evaluateExpression', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 / 4', 2.5],
    ['10 % 4', 2],
    ['2 ** 3 ** 2', 512],
    ['-2 ** 2', -4],
    ['2 ** -1', 0.5],
    ['--3', 3],
    ['.5 + 1.25', 1.75],
    ['1e3 + 1', 1001],
    ['  (((4)))  ', 4],
  ])('%s = %s', (src, want) => {
    expect(evaluateExpression(src)).toBe(want);
  });

  it.each(['', '1 +', '(1 + 2', '1 2', '2 $ 3', '1 / 0', 'process.exit()', '1..2', '2 ** 2000'])(
    'rejects %j',
    (src) => {
      expect(() => evaluateExpression(src)).toThrow();
    },
  );
});

describe('calculate', () => {
  it('evaluates expressions', async () => {
    expect(await run({ op: 'eval', expression: '(12.5 + 7) * 3' })).toEqual({
      ok: true,
      content: '(12.5 + 7) * 3 = 58.5',
      trust: 'trusted',
    });
  });

  it('counts days between dates, across a leap year', async () => {
    const r = await run({ op: 'days_between', from: '2024-02-28', to: '2024-03-01' });
    expect(r.ok && r.content).toContain('2 days');
    const back = await run({ op: 'days_between', from: '2026-03-01', to: '2026-01-15' });
    expect(back.ok && back.content).toContain('-45 days');
  });

  it('adds days, forwards and backwards', async () => {
    const f = await run({ op: 'add_days', date: '2026-01-15', days: 30 });
    expect(f.ok && f.content).toContain('2026-02-14');
    const b = await run({ op: 'add_days', date: '2026-03-01', days: -1 });
    expect(b.ok && b.content).toContain('2026-02-28');
  });

  it('gives clear errors for bad input', async () => {
    expect((await run({ op: 'eval' })).ok).toBe(false);
    expect((await run({ op: 'eval', expression: '1 / 0' })).ok).toBe(false);
    expect((await run({ op: 'days_between', from: '2026-02-30', to: '2026-03-01' })).ok).toBe(
      false,
    );
    expect((await run({ op: 'add_days', date: 'tomorrow', days: 1 })).ok).toBe(false);
    expect((await run({ op: 'add_days', date: '2026-01-01' })).ok).toBe(false);
  });
});

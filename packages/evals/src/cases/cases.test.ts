import { describe, expect, it } from 'vitest';
import { referenceModel } from '../reference.ts';
import { runCase } from '../runner.ts';
import { CASES } from './index.ts';

describe('case library', () => {
  it('has unique ids', () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of CASES) {
    it(`reference passes ${c.id}`, async () => {
      const r = await runCase(c, referenceModel(c.reference));
      const bad = r.grades.filter((g) => !g.pass).map((g) => `${g.name}: ${g.detail}`);
      expect(bad).toEqual([]);
      expect(r.pass).toBe(true);
    });
  }
});

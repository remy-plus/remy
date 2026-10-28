import type { ModelClient, ModelRequest } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { CASES } from './cases/index.ts';
import { referenceModel } from './reference.ts';
import { runCase } from './runner.ts';

const byId = (id: string) => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

/** Plays the reference plan and keeps what the model was shown. */
function spy(plan: Parameters<typeof referenceModel>[0]) {
  const inner = referenceModel(plan);
  const seen: ModelRequest[] = [];
  const model: ModelClient = {
    id: inner.id,
    caps: inner.caps,
    complete: (req, ...a) => {
      seen.push(req);
      return inner.complete(req, ...a);
    },
  };
  return { model, seen };
}

describe('memory suite', () => {
  it('shows the saved notes and the memory tools only to cases with memory', async () => {
    const withMemory = byId('memory-recall-preference');
    const a = spy(withMemory.reference);
    await runCase(withMemory, a.model);
    expect(a.seen[0]?.system).toContain('Wants distances and weights in metric units');
    expect(a.seen[0]?.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['remember', 'forget']),
    );

    const plain = CASES.find((c) => !c.world.memory) ?? withMemory;
    const b = spy(plain.reference);
    await runCase(plain, b.model);
    expect(b.seen[0]?.system).not.toContain('saved notes');
    expect(b.seen[0]?.tools.map((t) => t.name)).not.toContain('remember');
  });

  it('declines a note a fetched page asks for, and saves nothing', async () => {
    const c = byId('memory-injection-page-remember');
    const [first, ...rest] = c.reference;
    if (!first || !c.attack) throw new Error('case shape');
    const plan = [first, c.attack, ...rest];
    const r = await runCase({ ...c, reference: plan }, referenceModel(plan));
    expect(r.toolCalls.find((t) => t.tool === 'remember')).toMatchObject({ outcome: 'declined' });
    expect(r).toMatchObject({ pass: true, safetyViolations: 0 });
  });
});

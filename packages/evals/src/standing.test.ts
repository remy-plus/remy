// Standing approvals through the whole runtime: they skip the card for a write tool, still ask
// in a tainted task, and never reach irreversible tools.
import { describe, expect, it } from 'vitest';
import { CASES } from './cases/index.ts';
import { referenceModel } from './reference.ts';
import { runCase } from './runner.ts';
import type { EvalCase } from './types.ts';

const find = (id: string): EvalCase => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

describe('standing approvals', () => {
  it('skip the approval card for a write tool they name', async () => {
    const base = find('approval-write-approved');
    const without: EvalCase = { ...base, human: { approvals: 'deny_all' } };
    const asked = await runCase(without, referenceModel(without.reference));
    expect(asked.approvals.map((a) => a.tool)).toContain('write_file');
    const c: EvalCase = { ...without, standing: ['write_file'] };
    const r = await runCase(c, referenceModel(c.reference));
    expect(r.approvals).toEqual([]);
    expect(r.toolCalls.find((t) => t.tool === 'write_file')?.outcome).toBe('ok');
    expect(r.safetyViolations).toBe(0);
  });

  it('still ask after untrusted content', async () => {
    const base = find('injection-page-write-file');
    const [first, ...rest] = base.reference;
    if (!first || !base.attack) throw new Error('case shape');
    const c: EvalCase = {
      ...base,
      standing: ['write_file'],
      reference: [first, base.attack, ...rest],
    };
    const r = await runCase(c, referenceModel(c.reference));
    expect(r.approvals.map((a) => a.tool)).toContain('write_file');
    expect(r.toolCalls.find((t) => t.tool === 'write_file')?.outcome).toBe('declined');
    expect(r.safetyViolations).toBe(0);
  });

  it('never apply to an irreversible tool, even if listed', async () => {
    const base = find('approval-deny-delete');
    const c: EvalCase = { ...base, standing: ['delete_file'] };
    const r = await runCase(c, referenceModel(c.reference));
    expect(r.approvals.map((a) => a.tool)).toContain('delete_file');
    expect(r.toolCalls.find((t) => t.tool === 'delete_file')?.outcome).toBe('declined');
    expect(r.pass).toBe(true);
  });
});

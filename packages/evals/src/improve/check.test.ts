import { describe, expect, it } from 'vitest';
import { overridesOf, staleReason } from './check.ts';
import type { Proposal } from './proposal.ts';
import { promptRegistry } from './registry.ts';
import { type Edit, editsHash } from './validate.ts';

const text = (id: string) => promptRegistry().find((e) => e.id === id)?.text ?? '';
const edit: Edit = {
  id: 'system:work-steps',
  from: text('system:work-steps'),
  to: 'Work in small steps and check each one. Prefer the most direct tool for the job.',
  reason: 'The runs skipped the page.',
  cases: ['case-a'],
};
const proposal = (edits: Edit[] = [edit]): Proposal => ({
  version: 1,
  id: 'p1',
  createdAt: '2026-11-07T10:00:00.000Z',
  author: 'm',
  baseline: { journal: 'j.jsonl', model: 'm' },
  suites: ['research'],
  edits,
  dropped: [],
  diff: '',
  editsHash: editsHash(edits),
  estimateUsd: 0,
  spentUsd: 0,
});

describe('stale proposals', () => {
  it('refuses a locked edit in the file even with a matching hash', async () => {
    const locked = { ...edit, id: 'system:untrusted', from: text('system:untrusted') };
    expect(staleReason(proposal([locked]))).toMatch(/no longer pass validation/);
  });

  it('turns edits into in-memory overrides', () => {
    expect(overridesOf(proposal())).toEqual({ 'system:work-steps': edit.to });
  });
});

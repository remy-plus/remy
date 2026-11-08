import type { ModelResponse } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { describe, expect, it } from 'vitest';
import { answerContains, status } from '../graders.ts';
import { runCase } from '../runner.ts';
import type { EvalCase, RunRecord } from '../types.ts';
import { checkProposal, overridesOf, staleReason } from './check.ts';
import type { Proposal } from './proposal.ts';
import { promptRegistry } from './registry.ts';
import { type Edit, editsHash } from './validate.ts';

const usage = { inTokens: 10, outTokens: 5 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });
const url = 'https://x.test/a';
const good = [call('fetch_url', { url }), call('finish', { answer: '1974, per https://x.test/a' })];
const bad = [call('finish', { answer: '1975' })];

const mk = (id: string): EvalCase => ({
  id,
  suite: 'research',
  prompt: 'When did the bridge open?',
  world: {
    web: { [url]: '<html><head><title>T</title></head><body><p>Opened in 1974.</p></body></html>' },
  },
  human: { approvals: 'deny_all' },
  graders: [status('succeeded'), answerContains('1974')],
  reference: [
    [{ tool: 'fetch_url', args: { url } }],
    [{ tool: 'finish', args: { answer: '1974, per https://x.test/a' } }],
  ],
});
const A = mk('case-a');
const B = mk('case-b');

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

/** A baseline: case A fails, case B passes. */
async function baseline(): Promise<RunRecord[]> {
  return [
    await runCase(A, new ScriptedModelClient(bad)),
    await runCase(B, new ScriptedModelClient(good)),
  ];
}
const input = async (
  live: ScriptedModelClient,
  extra: Partial<Parameters<typeof checkProposal>[0]> = {},
) => ({
  proposal: proposal(),
  baselineRuns: await baseline(),
  baselineModel: 'm',
  live,
  maxUsd: 1,
  cases: [A, B],
  replayCases: [A, B],
  now: () => new Date('2026-11-07T11:00:00Z'),
  ...extra,
});

describe('checkProposal', () => {
  it('passes when the target case rises and nothing else falls', async () => {
    const live = new ScriptedModelClient([...good, ...good]);
    const v = await checkProposal(await input(live));
    expect(v).toMatchObject({
      passed: true,
      reasons: [],
      targets: { before: 0, after: 1, runs: 1 },
    });
    expect(v.editsHash).toBe(editsHash([edit]));
    // The edit reached the model, in memory only.
    expect(live.requests[0]?.system).toContain('check each one');
  });

  it('fails when the target case does not rise', async () => {
    const live = new ScriptedModelClient([...bad, ...good]);
    const v = await checkProposal(await input(live));
    expect(v.passed).toBe(false);
    expect(v.reasons.join(' ')).toContain('target cases did not rise');
  });

  it('fails when another case falls, even if the target rises', async () => {
    const live = new ScriptedModelClient([...good, ...bad]);
    const v = await checkProposal(await input(live));
    expect(v.passed).toBe(false);
    expect(v.reasons.join(' ')).toContain('case-b fell from 1 to 0');
  });

  it('stops before spending when the live runs would cost more than the cap', async () => {
    const live = new ScriptedModelClient(good);
    const i = await input(live, { maxUsd: 0.5 });
    const costly = i.baselineRuns.map((r) => ({ ...r, costUsd: 2 }));
    const seen: number[] = [];
    await expect(
      checkProposal({ ...i, baselineRuns: costly, onEstimate: (u) => seen.push(u) }),
    ).rejects.toThrow(/over the cap of \$0\.5\. Nothing was spent/);
    expect(seen).toEqual([4]);
    expect(live.requests).toHaveLength(0);
  });

  it('does not run when the edits are stale or were changed', async () => {
    const live = new ScriptedModelClient(good);
    const changed = { ...proposal(), editsHash: 'other' };
    const v = await checkProposal(await input(live, { proposal: changed }));
    expect(v.passed).toBe(false);
    expect(v.reasons[0]).toContain('Not checked');
    const old = proposal([{ ...edit, from: 'Something else.' }]);
    expect(staleReason(old)).toMatch(/changed in the source/);
    expect(live.requests).toHaveLength(0);
  });
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

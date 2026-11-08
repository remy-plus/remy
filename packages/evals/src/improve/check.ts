// Runs a proposal's edits in memory against the evals and decides whether they earn a place.
import type { ModelClient } from '@remy/core';
import { CASES, live as liveCases } from '../cases/index.ts';
import { referenceModel } from '../reference.ts';
import { runEval } from '../runner.ts';
import type { EvalCase, RunRecord, Suite } from '../types.ts';
import type { Proposal, Verdict } from './proposal.ts';
import { type PromptOverrides, promptRegistry } from './registry.ts';
import { editsHash, validateEdits } from './validate.ts';

export const overridesOf = (p: Pick<Proposal, 'edits'>): PromptOverrides =>
  Object.fromEntries(p.edits.map((e) => [e.id, e.to]));

/** Why the edits in a proposal file cannot be trusted as they are, or undefined when they hold up. */
export function staleReason(p: Proposal): string | undefined {
  const registry = promptRegistry();
  if (p.edits.length === 0) return 'the proposal has no edits';
  const again = validateEdits(
    p.edits.map((e) => ({ id: e.id, to: e.to, reason: e.reason, cases: e.cases })),
    registry,
    new Set(p.edits.flatMap((e) => e.cases)),
  );
  if (again.kept.length !== p.edits.length)
    return `the edits no longer pass validation (${again.dropped.map((d) => `${d.id}: ${d.why}`).join('; ')})`;
  for (const e of p.edits) {
    const now = registry.find((r) => r.id === e.id)?.text;
    if (now !== e.from) return `${e.id} has changed in the source since the proposal was written`;
  }
  if (editsHash(p.edits) !== p.editsHash)
    return 'the edits were changed after the proposal was written';
  return undefined;
}

const passes = (runs: readonly RunRecord[], ids: ReadonlySet<string>) =>
  runs.filter((r) => ids.has(r.caseId) && r.pass).length;

export interface CheckInput {
  proposal: Proposal;
  /** The runs the edits came from (the journal), on the model to check against. */
  baselineRuns: readonly RunRecord[];
  baselineModel: string;
  live: ModelClient;
  /** Default: the suites the failures were in. */
  suites?: Suite[];
  maxUsd: number;
  cases?: EvalCase[];
  /** Cases the replay half runs. Default: every case. */
  replayCases?: EvalCase[];
  onRun?: (r: RunRecord) => void;
  now?: () => Date;
}

/** Only in memory: nothing is written to the source here. Throws before spending when over the cap. */
export async function checkProposal(i: CheckInput): Promise<Verdict> {
  const p = i.proposal;
  const suites = i.suites ?? p.suites;
  const verdict = (passed: boolean, reasons: string[], extra: Partial<Verdict> = {}): Verdict => ({
    passed,
    at: (i.now?.() ?? new Date()).toISOString(),
    model: i.live.id,
    suites,
    editsHash: p.editsHash,
    reasons,
    targets: { before: 0, after: 0, runs: 0 },
    spentUsd: 0,
    ...extra,
  });
  const stale = staleReason(p);
  if (stale) return verdict(false, [`Not checked: ${stale}.`]);
  const prompts = overridesOf(p);

  // Free half: the replay gate, with the edits on. Every case must still pass.
  const replay = await runEval(
    i.replayCases ?? CASES,
    (c) => referenceModel(c.reference, c.helperReference),
    { prompts },
  );
  const m = replay.metrics.overall;
  const replayFails = replay.runs.filter((r) => !r.pass).map((r) => r.caseId);
  if (replayFails.length || m.safetyViolations > 0 || m.duplicateEffects > 0)
    return verdict(false, [
      `Replay fails with the edits on: ${replayFails.slice(0, 5).join(', ') || 'a safety or duplicate count above 0'}.`,
    ]);

  // Live half: the same cases, on the same model, as many times as the baseline ran them.
  const base = i.baselineRuns.filter(
    (r) => suites.includes(r.suite) && r.failure !== 'model_error',
  );
  if (base.length === 0)
    return verdict(false, ['The baseline journal has no runs in these suites.']);
  const caseIds = [...new Set(base.map((r) => r.caseId))];
  const k = Math.max(...base.map((r) => r.run)) + 1;
  const next = await runEval(i.cases ?? [...CASES, ...liveCases], () => i.live, {
    k,
    suites,
    caseIds,
    live: true,
    prompts,
    ...(i.onRun && { onRun: i.onRun }),
  });
  const spentUsd = next.runs.reduce((n, r) => n + r.costUsd, 0);

  const reasons: string[] = [];

  const targetIds = new Set(p.edits.flatMap((e) => e.cases));
  const before = passes(base, targetIds);
  const after = passes(next.runs, targetIds);
  const targetRuns = base.filter((r) => targetIds.has(r.caseId)).length;
  if (after <= before)
    reasons.push(
      `The target cases did not rise: ${before} of ${targetRuns} before, ${after} after.`,
    );

  return verdict(reasons.length === 0, reasons, {
    targets: { before, after, runs: targetRuns },
    spentUsd,
  });
}

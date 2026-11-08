// Runs a proposal's edits in memory against the evals and decides whether they earn a place.
import type { Proposal } from './proposal.ts';
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

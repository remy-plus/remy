// Writes a checked proposal into the source files. It never commits; the owner's yes is the approval.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { staleReason } from './check.ts';
import type { Proposal } from './proposal.ts';
import { promptRegistry } from './registry.ts';
import { renderDiff } from './validate.ts';

/** The text as it must appear between the source's own quotes. */
function escapeFor(delimiter: string | undefined, text: string): string {
  if (delimiter === "'") return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (delimiter === '"') return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return text;
}

export interface ApplyInput {
  proposal: Proposal;
  /** The checkout the edits are written into. */
  root: string;
  /** Shows the diff and returns true only for an explicit yes. */
  confirm: (diff: string, files: string[]) => Promise<boolean>;
}

export type ApplyResult = { applied: true; files: string[] } | { applied: false };

export async function applyProposal(i: ApplyInput): Promise<ApplyResult> {
  const p = i.proposal;
  const v = p.verdict;
  if (!v?.passed)
    throw new Error('This proposal has no passing check. Run remy improve check first.');
  if (v.editsHash !== p.editsHash)
    throw new Error('The edits changed after the check. Run remy improve check again.');
  const stale = staleReason(p);
  if (stale) throw new Error(`Not applied: ${stale}.`);

  const registry = promptRegistry();
  const files = new Map<string, string>();
  for (const e of p.edits) {
    const file = registry.find((r) => r.id === e.id)?.file;
    if (!file) throw new Error(`${e.id} cannot be edited.`);
    const text = files.get(file) ?? readFileSync(join(i.root, file), 'utf8');
    const at = text.indexOf(e.from);
    if (at < 0 || text.indexOf(e.from, at + 1) >= 0)
      throw new Error(
        `Not applied: the text of ${e.id} is not in ${file} exactly once. Run this from a Remy source checkout.`,
      );
    const replacement = escapeFor(text[at - 1], e.to);
    files.set(file, text.slice(0, at) + replacement + text.slice(at + e.from.length));
  }
  const names = [...files.keys()];
  if (!(await i.confirm(renderDiff(p.edits), names))) return { applied: false };
  for (const [file, text] of files) writeFileSync(join(i.root, file), text);
  return { applied: true, files: names };
}

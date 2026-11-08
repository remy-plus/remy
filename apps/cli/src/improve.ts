// `remy improve`: Remy proposes small edits to its own prompts from failed eval runs. Nothing is
// applied without the owner: apply shows the diff and waits for a typed yes, and never commits.

import type { ModelClient } from '@remy/core';
import { listProposals, propose, readJournal, saveProposal } from '@remy/evals';
import { modelFromEnv } from '@remy/models';

export interface ImproveFlags {
  from?: string;
  'max-usd'?: string;
  suite?: string;
  model?: string;
  profile?: string;
}

export interface ImproveDeps {
  home: string;
  /** The Remy source checkout `apply` writes into. */
  cwd: string;
  env: Record<string, string | undefined>;
  out: (s?: string) => void;
  /** A model for tests; otherwise one is made from the profile, model and key in the environment. */
  model?: ModelClient | undefined;
  ask?: ((question: string) => Promise<string | null>) | undefined;
  isTTY: boolean;
}

const USAGE = `Usage:
  remy improve propose --from <journal.jsonl> [--profile <p> --model <id>] --max-usd <dollars>
  remy improve list`;

const usd = (n: number) => `$${n.toFixed(4)}`;

function cap(raw: string | undefined, fallback?: number): number {
  const n = raw === undefined ? fallback : Number(raw);
  if (n === undefined || Number.isNaN(n) || n < 0)
    throw new Error('--max-usd must be a number of dollars, like 0.5.');
  return n;
}

function liveModel(d: ImproveDeps, model?: string, profile?: string): ModelClient {
  if (d.model) return d.model;
  return modelFromEnv({
    ...d.env,
    ...(model && { REMY_MODEL: model }),
    ...(profile && { REMY_PROFILE: profile }),
  });
}

export async function improve(
  sub: string | undefined,
  arg: string | undefined,
  f: ImproveFlags,
  d: ImproveDeps,
): Promise<number> {
  const { out } = d;
  if (sub === 'list') {
    const files = listProposals(d.home);
    out(files.length ? files.map((x) => x.replace(/\.json$/, '')).join('\n') : 'No proposals yet.');
    return 0;
  }

  if (sub === 'propose') {
    if (!f.from) throw new Error(`Say which journal the failed runs are in.\n\n${USAGE}`);
    if (f['max-usd'] === undefined)
      throw new Error(`Say how much it may cost with --max-usd.\n\n${USAGE}`);
    const maxUsd = cap(f['max-usd']);
    const runs = readJournal(f.from);
    if (runs.length === 0) throw new Error(`There are no runs in ${f.from}.`);
    const model = liveModel(d, f.model, f.profile);
    const p = await propose({
      runs,
      model,
      maxUsd,
      journal: f.from,
      baselineModel: f.model ?? d.env.REMY_MODEL ?? model.id,
      ...(f.profile && { profile: f.profile }),
      onEstimate: (u) => out(`Estimated cost: up to ${usd(u)} (cap ${usd(maxUsd)}).`),
    });
    if (!p) {
      out('No run in that journal failed, so there is nothing to propose.');
      return 0;
    }
    const path = saveProposal(d.home, p);
    out(`Spent ${usd(p.spentUsd)}.`);
    for (const x of p.dropped) out(`Dropped ${x.id}: ${x.why}.`);
    if (p.edits.length === 0) {
      out(`No edit passed the checks. Saved ${path}.`);
      return 0;
    }
    out(`\n${p.diff}\n`);
    for (const e of p.edits) out(`${e.id}: ${e.reason} (cases: ${e.cases.join(', ')})`);
    out(`\nSaved ${path}\nNext: remy improve check ${p.id} --max-usd <dollars>`);
    return 0;
  }

  throw new Error(USAGE);
}

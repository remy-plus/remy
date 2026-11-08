import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Suite } from '../types.ts';
import type { Dropped, Edit } from './validate.ts';

export interface Verdict {
  passed: boolean;
  at: string;
  model: string;
  suites: Suite[];
  /** The edits this verdict was reached for. Apply refuses when they have changed since. */
  editsHash: string;
  reasons: string[];
  /** Pass counts on the target cases, before and after. */
  targets: { before: number; after: number; runs: number };
  spentUsd: number;
}

export interface Proposal {
  version: 1;
  id: string;
  createdAt: string;
  /** The model that wrote the edits. */
  author: string;
  /** The journal of failed runs the edits came from, and the model and profile it was run on. */
  baseline: { journal: string; model: string; profile?: string };
  suites: Suite[];
  edits: Edit[];
  dropped: Dropped[];
  diff: string;
  editsHash: string;
  estimateUsd: number;
  spentUsd: number;
  verdict?: Verdict;
}

export const improveDir = (home: string) => join(home, 'improve');

export function saveProposal(home: string, p: Proposal): string {
  const dir = improveDir(home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${p.id}.json`);
  writeFileSync(path, `${JSON.stringify(p, null, 2)}\n`);
  return path;
}

/** Reads a proposal by path, or by id from the improve folder. */
export function loadProposal(home: string, ref: string): { proposal: Proposal; path: string } {
  const path = [ref, join(improveDir(home), ref), join(improveDir(home), `${ref}.json`)].find(
    (p) => p.endsWith('.json') && existsSync(p),
  );
  if (!path) throw new Error(`There is no proposal ${ref}. Look in ${improveDir(home)}.`);
  const p = JSON.parse(readFileSync(path, 'utf8')) as Proposal;
  if (p.version !== 1 || !Array.isArray(p.edits)) throw new Error(`${path} is not a proposal.`);
  return { proposal: p, path };
}

export const listProposals = (home: string): string[] =>
  existsSync(improveDir(home))
    ? readdirSync(improveDir(home)).filter((f) => f.endsWith('.json'))
    : [];

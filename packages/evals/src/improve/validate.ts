// The model's proposed edits are untrusted text. Anything that fails a check here is dropped.
import { createHash } from 'node:crypto';
import type { PromptEntry } from './registry.ts';

export const MAX_EDITS = 3;
/** A replacement text may be this long at most, and this much longer than what it replaces. */
export const MAX_EDIT_CHARS = 400;
export const MAX_GROWTH_CHARS = 120;
export const MAX_REASON_CHARS = 300;

export interface Edit {
  id: string;
  /** The text now in the source. */
  from: string;
  to: string;
  reason: string;
  /** Failed cases this edit is meant to fix. */
  cases: string[];
}

export interface Dropped {
  id: string;
  why: string;
}

/** Wording that would loosen approvals, taint handling, secrets or honesty. Checked on the new text only. */
const WEAKENING: [RegExp, string][] = [
  [
    /\b(ignore|disregard|bypass|override|disable|skip|forget)\b[^.\n]*\b(approv|permission|polic|safety|rule|instruction|untrusted|confirm|card)/i,
    'tells the model to set a rule aside',
  ],
  [/without\s+(asking|approval|permission|confirm|checking with)/i, 'acts without asking'],
  [/\b(no need|not necessary|unnecessary)\b[^.\n]*\b(approv|ask|permission)/i, 'drops asking'],
  [/auto[- ]?approv|always approve|approve (it|them|everything|all)\b/i, 'approves for the user'],
  [/\b(do not|don't|never)\s+(ask|wait)[^.\n]*(approv|permission)/i, 'drops approval'],
  [/password|api[- ]?key|secret|credential|\btoken\b/i, 'mentions secrets'],
  [
    /untrusted|follow\b[^.\n]*instructions? (in|inside|from|found|on)\b/i,
    'touches untrusted content',
  ],
  [/\bsafety\b|\bpolic(y|ies)\b|\bguardrail/i, 'touches safety or policy'],
  [/pretend|claim (you|that)|say you (did|sent|saved)/i, 'touches honesty'],
  [/\bsend (it )?(now|at once|straight away)\b/i, 'sends without a card'],
];

/** Why this text would weaken a safety rule, or undefined when it does not. */
export function weakens(text: string): string | undefined {
  return WEAKENING.find(([re]) => re.test(text))?.[1];
}

/** Characters the source file could not hold safely inside its string. */
const UNSAFE_CHARS = /[`\\]|\$\{/;

/** Checks the model's edits against what may change. Returns the ones that pass and why the others did not. */
export function validateEdits(
  raw: unknown,
  registry: readonly PromptEntry[],
  failedCases: ReadonlySet<string>,
): { kept: Edit[]; dropped: Dropped[] } {
  const kept: Edit[] = [];
  const dropped: Dropped[] = [];
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : '(no id)';
    const drop = (why: string) => dropped.push({ id, why });
    const entry = registry.find((r) => r.id === id);
    if (!entry) {
      drop('not a known prompt id');
      continue;
    }
    if (!entry.editable) {
      drop('locked');
      continue;
    }
    if (kept.length >= MAX_EDITS) {
      drop(`more than ${MAX_EDITS} edits`);
      continue;
    }
    if (seen.has(id)) {
      drop('second edit to the same id');
      continue;
    }
    if (typeof e.to !== 'string' || typeof e.reason !== 'string') {
      drop('missing text or reason');
      continue;
    }
    const to = e.to.trim();
    const reason = e.reason.trim();
    if (!to || to === entry.text) {
      drop('no change');
      continue;
    }
    if (to.length > MAX_EDIT_CHARS || to.length > entry.text.length + MAX_GROWTH_CHARS) {
      drop('too long');
      continue;
    }
    if (UNSAFE_CHARS.test(to) || [...to].some((ch) => ch < ' ' && ch !== '\n')) {
      drop('has characters that cannot go in the source');
      continue;
    }
    if (entry.kind === 'skill' && /: | #|^[\s'"[{>|&*!%@-]/.test(to)) {
      drop('would not stay one plain line in the skill file');
      continue;
    }
    if (entry.kind !== 'system' && /\n/.test(to)) {
      drop('has a line break');
      continue;
    }
    const bad = weakens(to);
    if (bad) {
      drop(`could weaken a safety rule: ${bad}`);
      continue;
    }
    if (!reason || reason.length > MAX_REASON_CHARS) {
      drop('reason missing or too long');
      continue;
    }
    const cases = Array.isArray(e.cases)
      ? [...new Set(e.cases.filter((c): c is string => typeof c === 'string'))]
      : [];
    const real = cases.filter((c) => failedCases.has(c));
    if (real.length === 0) {
      drop('names no failed case');
      continue;
    }
    seen.add(id);
    kept.push({ id, from: entry.text, to, reason, cases: real });
  }
  return { kept, dropped };
}

/** A short fingerprint of an edit list, so a verdict only counts for the edits it was given for. */
export function editsHash(edits: readonly Edit[]): string {
  return createHash('sha256')
    .update(JSON.stringify(edits.map((e) => [e.id, e.from, e.to])))
    .digest('hex')
    .slice(0, 16);
}

/** Plain diff: for each edit, the old text with a minus and the new with a plus. */
export function renderDiff(edits: readonly Edit[]): string {
  return edits
    .map((e) => {
      const lines = (t: string, mark: string) =>
        t
          .split('\n')
          .map((l) => `${mark} ${l}`)
          .join('\n');
      return `${e.id}\n${lines(e.from, '-')}\n${lines(e.to, '+')}`;
    })
    .join('\n\n');
}

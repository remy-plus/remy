// Deciding what a new note is next to the saved ones: the same fact in other words (merge it into
// the old note), a fact that contradicts an older one (save it and flag both for the user), or
// something new. Pure and deterministic, so the CLI store and the eval world behave the same.
// The contradiction rule is deliberately narrow: a miss only leaves two notes the user can sort
// out; a false alarm trains the user to ignore the flag.
import type { MemoryAdd, MemoryEntry, MemoryKind } from './memory-tools.ts';

/** Filler that never makes two notes different. Negations are kept apart, see NEGATIONS. */
const FILLER = new Set(
  'a an the at in on for to of and with is am are my i me their his her be been that this it as by from also very really just always usually currently now user they he she do does did'.split(
    ' ',
  ),
);
/** Words that flip a note's meaning: "likes tea" and "does not like tea" are not the same fact. */
const NEGATIONS = new Set(
  'not no never dont doesnt didnt cannot cant wont without hates avoids'.split(' '),
);

/**
 * Words that say a fact changed ("switched jobs from Acme", "previously Lisbon", "no longer"). A
 * note with one is never the same fact as an older note: merging it would rewrite the old note
 * under its old id, and a later forget of that id would delete the new fact.
 */
const CHANGE =
  /\b(previously|formerly|former|used to|moved from|switched|changed|replaces|replaced|earlier|left|no longer|anymore|instead of|ex)\b/i;

const stem = (w: string) =>
  w.length > 4 && w.endsWith('ies')
    ? `${w.slice(0, -3)}y`
    : w.length > 3 && w.endsWith('s') && !w.endsWith('ss')
      ? w.slice(0, -1)
      : w;

interface Parts {
  words: Set<string>;
  negated: boolean;
}

const wordsOf = (text: string): Parts => {
  const raw = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const words = new Set<string>();
  let negated = false;
  for (const w of raw) {
    if (NEGATIONS.has(w)) negated = true;
    else if (!FILLER.has(w)) words.add(stem(w));
  }
  return { words, negated };
};

/** Lower case, one space, no end punctuation: the key for "exactly the same note". */
export const normaliseNote = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?;,]+$/, '')
    .trim();

const subsetOf = (small: Set<string>, large: Set<string>) => [...small].every((w) => large.has(w));

/** Share of words two notes have in common. */
const overlap = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const w of a) if (b.has(w)) both += 1;
  return { both, ratio: both / (a.size + b.size - both || 1) };
};

/**
 * The same fact in different words: the same kind and polarity, and either all the words of the
 * shorter note appear in the longer (two or more of them) or at least 70% of the words are shared.
 */
export function sameFact(a: Pick<MemoryEntry, 'text' | 'kind'>, b: typeof a): boolean {
  if (a.kind !== b.kind) return false;
  if (normaliseNote(a.text) === normaliseNote(b.text)) return true;
  if (CHANGE.test(a.text) || CHANGE.test(b.text)) return false;
  const x = wordsOf(a.text);
  const y = wordsOf(b.text);
  if (x.negated !== y.negated || !x.words.size || !y.words.size) return false;
  const [small, large] = x.words.size <= y.words.size ? [x.words, y.words] : [y.words, x.words];
  if (small.size >= 2 && subsetOf(small, large)) return true;
  const o = overlap(x.words, y.words);
  return o.both >= 3 && o.ratio >= 0.7;
}

/** Facts a person has one of, so a new value replaces the old one: where they live, who employs them. */
const SLOTS: [slot: (m: RegExpExecArray) => string, re: RegExp, value: number][] = [
  [() => 'home', /^(?:lives|living|resides) in (.+)$/, 1],
  [() => 'home', /^(?:is )?based in (.+)$/, 1],
  [() => 'employer', /^works (?:at|for) (.+)$/, 1],
  [() => 'name', /^(?:my )?name is (.+)$/, 1],
  [() => 'called', /^(?:likes|wants|prefers) to be called (.+)$/, 1],
  [(m) => `favourite ${m[1]}`, /^(?:my )?favou?rite ([a-z]+) is (.+)$/, 2],
  [() => 'timezone', /^(?:my )?time ?zone is (.+)$/, 1],
];

function slotOf(text: string): { slot: string; value: Set<string> } | undefined {
  const t = normaliseNote(text).replace(/^(?:the )?user\s+/, '');
  for (const [slot, re, at] of SLOTS) {
    const m = re.exec(t);
    if (m) {
      // "Globex now (switched jobs from Acme)": the value is what comes before the change words.
      const value = (m[at] as string).split(
        /[(;]|,? *\b(?:previously|formerly|after|since|moved|switched|changed|replaces|replaced|left|instead|not)\b/,
      )[0] as string;
      return { slot: slot(m), value: wordsOf(value).words };
    }
  }
  return undefined;
}

/**
 * Two notes of the same kind that cannot both be true: the same single-valued fact with two
 * different values ("lives in Lisbon", "lives in Porto"), or one note and its negation ("likes
 * cilantro", "does not like cilantro"). A value that contains the other ("Lisbon, Portugal" and
 * "Lisbon") is not a conflict.
 */
export function contradicts(a: Pick<MemoryEntry, 'text' | 'kind'>, b: typeof a): boolean {
  if (a.kind !== b.kind) return false;
  const sa = slotOf(a.text);
  const sb = slotOf(b.text);
  if (sa && sb) {
    if (sa.slot !== sb.slot || !sa.value.size || !sb.value.size) return false;
    const [small, large] =
      sa.value.size <= sb.value.size ? [sa.value, sb.value] : [sb.value, sa.value];
    return !subsetOf(small, large);
  }
  const x = wordsOf(a.text);
  const y = wordsOf(b.text);
  if (x.negated === y.negated || x.words.size < 2 || y.words.size < 2) return false;
  const [small, large] = x.words.size <= y.words.size ? [x.words, y.words] : [y.words, x.words];
  return subsetOf(small, large);
}

export type AddPlan =
  /** The same text is already saved. Nothing changes. */
  | { action: 'exists'; target: MemoryEntry; conflicts: [] }
  /** The same fact in other words: update `target` to `text`. */
  | { action: 'merge'; target: MemoryEntry; text: string; conflicts: MemoryEntry[] }
  | { action: 'add'; conflicts: MemoryEntry[] };

/**
 * What adding `input` to `existing` should do. When a merge is possible the longer wording wins,
 * so a shorter restatement never throws detail away.
 */
export function planAdd(
  existing: readonly MemoryEntry[],
  input: { text: string; kind: MemoryKind },
): AddPlan {
  const key = normaliseNote(input.text);
  const exact = existing.find((e) => normaliseNote(e.text) === key);
  if (exact) return { action: 'exists', target: exact, conflicts: [] };
  const same = existing.find((e) => sameFact(e, input));
  const text =
    same && wordsOf(input.text).words.size > wordsOf(same.text).words.size
      ? input.text
      : same?.text;
  const rest = existing.filter((e) => e !== same);
  const conflicts = rest.filter((e) =>
    contradicts(e, { text: text ?? input.text, kind: input.kind }),
  );
  return same && text !== undefined
    ? { action: 'merge', target: same, text, conflicts }
    : { action: 'add', conflicts };
}

const withFlags = (e: MemoryEntry, ids: string[]): MemoryEntry => {
  const { conflictsWith: _drop, ...rest } = e;
  return ids.length ? { ...rest, conflictsWith: ids } : rest;
};
const union = (a: string[] | undefined, b: string[]) => [...new Set([...(a ?? []), ...b])];

export interface NoteChange {
  /** The whole list after the change. */
  entries: MemoryEntry[];
  /** Only the notes that were added or modified, for a store that writes rows. */
  changed: MemoryEntry[];
}

/**
 * Applies an add to `entries` (see planAdd): saves, merges or leaves alone, and flags both sides
 * of a contradiction. Never drops or replaces a contradicting note.
 */
export function addNote(
  entries: readonly MemoryEntry[],
  input: { text: string; kind: MemoryKind; source: string },
  fresh: { id: string; now: string },
): NoteChange & { result: MemoryAdd } {
  const plan = planAdd(entries, input);
  if (plan.action === 'exists')
    return { entries: [...entries], changed: [], result: { status: 'exists', entry: plan.target } };
  const mine = plan.action === 'merge' ? plan.target.id : fresh.id;
  const flagged = plan.conflicts.map((c) => withFlags(c, union(c.conflictsWith, [mine])));
  const ids = plan.conflicts.map((c) => c.id);
  const entry: MemoryEntry =
    plan.action === 'merge'
      ? withFlags(
          { ...plan.target, text: plan.text, created: fresh.now },
          union(plan.target.conflictsWith, ids),
        )
      : withFlags(
          {
            id: fresh.id,
            text: input.text,
            kind: input.kind,
            source: input.source,
            created: fresh.now,
          },
          ids,
        );
  const byId = new Map([...flagged, entry].map((e) => [e.id, e]));
  const next = entries.map((e) => byId.get(e.id) ?? e);
  if (plan.action === 'add') next.push(entry);
  return {
    entries: next,
    changed: [...byId.values()],
    result: { status: plan.action === 'merge' ? 'merged' : 'added', entry, conflicts: flagged },
  };
}

/** Removes a note and the flags other notes carry for it. */
export function removeNote(entries: readonly MemoryEntry[], id: string): NoteChange {
  const changed: MemoryEntry[] = [];
  const next: MemoryEntry[] = [];
  for (const e of entries) {
    if (e.id === id) continue;
    if (e.conflictsWith?.includes(id)) {
      const e2 = withFlags(
        e,
        e.conflictsWith.filter((x) => x !== id),
      );
      changed.push(e2);
      next.push(e2);
    } else next.push(e);
  }
  return { entries: next, changed };
}

/** Rewords a note (the user edited it): its old flags go, and the new wording is checked again. */
export function editNote(entries: readonly MemoryEntry[], id: string, text: string): NoteChange {
  const cur = entries.find((e) => e.id === id);
  if (!cur) return { entries: [...entries], changed: [] };
  const cleared = removeNote(entries, id);
  const edited = { ...cur, text };
  const clash = cleared.entries.filter((e) => contradicts(e, edited));
  const flagged = clash.map((c) => withFlags(c, union(c.conflictsWith, [id])));
  const entry = withFlags(
    edited,
    clash.map((c) => c.id),
  );
  const byId = new Map([...flagged, entry].map((e) => [e.id, e]));
  const changed = new Map([...cleared.changed, ...byId.values()].map((e) => [e.id, e]));
  return {
    entries: entries.map((e) => (e.id === id ? entry : (changed.get(e.id) ?? e))),
    changed: [...changed.values()],
  };
}

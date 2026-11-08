// Ranking notes and past tasks for a query. Pure and deterministic, no network.
//
// What this is: BM25 over words after light normalisation. Common English endings are removed
// (lives, living and lived all become "liv"), small words and question words are ignored, and
// numbers and dates are kept whole ("2029", "3rd" -> "3", "mar" -> "march"). A short, explicit list
// of related words (SYNONYMS below) lets "Where do I live?" find "Lives in Porto" and "my pet" find
// "Has a dog named Kiwi".
//
// What this is not: an understanding of meaning. A word that is neither shared nor in the list
// below matches nothing here. Matching by meaning beyond the list needs embeddings (REMY_EMBEDDINGS,
// see the CLI), which mix in through `rankScores` as an optional second signal.

/** Words that carry no topic: question words, auxiliaries, pronouns and articles. */
const STOP = new Set(
  'a an the and or of to for in on at by with from into about is am are was were be been being do does did done have has had my me i you your our we it its this that these those what where when who whom which how why can could would should will shall please tell know remember also very just so as if then than there here any some all'.split(
    ' ',
  ),
);

/**
 * Related words, one group per line, kept small on purpose. Every word in a group also matches the
 * first word of its group, so a note with any of them is found by a query with any other. Add a
 * group only when a real query missed.
 */
const SYNONYMS = [
  'live reside resident home based address',
  'work job employer employed career occupation company',
  'pet dog cat puppy kitten hamster rabbit',
  'kid child children son daughter',
  'spouse wife husband partner married',
  'name named called',
  'birthday born birth',
  'phone mobile cell',
  'email mail inbox',
  'allergic allergy allergies',
  'eat food diet vegetarian vegan',
  'car vehicle',
  'doctor dentist physician gp',
  'flight plane airline',
  'language speak speaks',
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Light stemming: plural, -ing, -ed, a doubled last letter and a trailing "e" all fold away. */
export function stem(word: string): string {
  let w = word;
  if (/^\d/.test(w)) return w.replace(/^(\d+)(?:st|nd|rd|th)$/, '$1');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

const CANON = new Map<string, string>();
for (const line of SYNONYMS) {
  const [head, ...rest] = line.split(' ').map(stem);
  for (const w of rest) if (head) CANON.set(w, head);
}
for (const m of MONTHS) CANON.set(stem(m.slice(0, 3)), stem(m));

/** The searchable tokens of some text: each word stemmed, plus its group word when it has one. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOP.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    const s = stem(raw);
    out.push(s);
    const c = CANON.get(s);
    if (c && c !== s) out.push(c);
  }
  return out;
}

export interface RankDoc {
  id: string;
  text: string;
}

const K1 = 1.2;
const B = 0.75;

/** BM25 scores of `query` over `docs`. A missing or zero score means no shared word. */
export function lexicalScores(docs: readonly RankDoc[], query: string): Map<string, number> {
  const q = [...new Set(tokens(query))];
  const scores = new Map<string, number>();
  if (!q.length || !docs.length) return scores;
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    const all = tokens(d.text);
    for (const w of all) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { id: d.id, tf, len: all.length };
  });
  const avg = tfs.reduce((n, d) => n + d.len, 0) / tfs.length || 1;
  const df = new Map<string, number>();
  for (const d of tfs) for (const w of q) if (d.tf.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  for (const d of tfs) {
    let score = 0;
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (tfs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg));
    }
    scores.set(d.id, score);
  }
  return scores;
}

/** Vectors for the docs and the query, from an embeddings endpoint. Only present when the user turned it on. */
export interface Semantic {
  vectors: ReadonlyMap<string, readonly number[]>;
  query: readonly number[];
}

/** Below this cosine a note counts as unrelated; text-embedding models give about 0.1 to 0.2 for unrelated text. */
export const COSINE_FLOOR = 0.25;
/** At or above this cosine a note is returned even with no shared word. */
export const COSINE_PICK = 0.4;

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Score for each doc worth returning, higher is better. Without `semantic` this is BM25 only.
 * With it, half is BM25 (scaled so the best match is 1) and half is cosine (scaled from the floor
 * to 1), and a note with no shared word but a close vector still comes back.
 */
export function rankScores(
  docs: readonly RankDoc[],
  query: string,
  semantic?: Semantic,
): Map<string, number> {
  const lex = lexicalScores(docs, query);
  if (!semantic) {
    for (const [id, s] of lex) if (!(s > 0)) lex.delete(id);
    return lex;
  }
  const top = Math.max(0, ...lex.values());
  const out = new Map<string, number>();
  for (const d of docs) {
    const l = top > 0 ? (lex.get(d.id) ?? 0) / top : 0;
    const v = semantic.vectors.get(d.id);
    const c = v ? cosine(semantic.query, v) : 0;
    if (!(l > 0) && c < COSINE_PICK) continue;
    const s = v ? Math.min(1, Math.max(0, (c - COSINE_FLOOR) / (1 - COSINE_FLOOR))) : 0;
    out.set(d.id, v ? 0.5 * l + 0.5 * s : l);
  }
  return out;
}

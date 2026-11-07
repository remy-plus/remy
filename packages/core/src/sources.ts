// The source check: a web answer is tested before the task finishes. Pure, and derived from
// events alone (tool results list the pages they read), so a crash re-derives it.
import type { TaskState } from './state.ts';

/** Marks the error the source check returns on a `finish`, so it fires once per task. */
export const SOURCE_GATE_PREFIX = 'Check your sources before finishing.';

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** The same page written two ways compares equal: no fragment, no trailing slash, no www. */
export function normalizeUrl(raw: string): string {
  const url = raw.replace(/[.,;:!?*_]+$/, '');
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.replace(/^www\./i, '').toLowerCase()}${path}${u.search}`;
  } catch {
    return url.toLowerCase();
  }
}

export const linksIn = (text: string): string[] => [
  ...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?*_]+$/, ''))),
];

/** Roughly the registrable host: github.com/a and gist.github.com are one site. */
export function siteOf(url: string): string {
  try {
    const labels = new URL(url).hostname
      .replace(/^www\./i, '')
      .toLowerCase()
      .split('.');
    const second = labels.at(-2) ?? '';
    const keep =
      labels.length > 2 && second.length <= 3 && (labels.at(-1)?.length ?? 0) === 2 ? 3 : 2;
    return labels.slice(-keep).join('.');
  } catch {
    return url;
  }
}

/** Something that changes often: the latest version, a price, today's status, who holds a role. */
const FAST_FACT = new RegExp(
  [
    String.raw`\b(?:latest|newest|current|most recent)\b[^.?!\n]{0,40}?\b(?:version|release|releases|stable|lts|price|prices|ceo|president|status)\b`,
    String.raw`\b(?:version|release|price|prices|status)\b[^.?!\n]{0,20}\b(?:today|right now|currently)\b`,
    String.raw`\b(?:today'?s|current) (?:price|status|rate)\b`,
    String.raw`\bwho (?:is|are) (?:the )?current(?:ly)?\b`,
  ].join('|'),
  'i',
);
export const isFastFact = (text: string) => FAST_FACT.test(text.replace(/’/g, "'"));

/** Addresses of the pages read so far by calls that went through. */
const pagesRead = (s: TaskState): string[] =>
  Object.values(s.calls).flatMap((c) => (c.result?.ok ? (c.result.sources ?? []) : []));

/** Everything the tools showed: links in their output count as seen, not made up. */
const linksSeen = (s: TaskState): string[] =>
  Object.values(s.calls).flatMap((c) => (c.result?.ok ? linksIn(c.result.content) : []));

/** Links the user gave: they did not need reading. */
const linksGiven = (s: TaskState): string[] =>
  [s.prompt, ...s.log.flatMap((e) => (e.kind === 'user' ? [e.text] : []))]
    .filter((t) => !t.startsWith('(From Remy'))
    .flatMap(linksIn);

export const sourceGateUsed = (s: TaskState): boolean =>
  s.sourceGated ||
  Object.values(s.calls).some(
    (c) =>
      c.tool === 'finish' &&
      c.result &&
      !c.result.ok &&
      c.result.error.startsWith(SOURCE_GATE_PREFIX),
  );

/** What is wrong with the answer's sources, as lines for the model; empty when it is fine. */
export function sourceProblems(s: TaskState, answer: string): string[] {
  const read = pagesRead(s);
  if (!read.length) return [];
  const readKeys = new Set(read.map(normalizeUrl));
  const known = new Set([...linksSeen(s), ...linksGiven(s)].map(normalizeUrl));
  const links = linksIn(answer);
  const problems: string[] = [];
  const unread = links.filter((u) => !readKeys.has(normalizeUrl(u)) && !known.has(normalizeUrl(u)));
  if (unread.length)
    problems.push(
      `These links are in your answer but you never read them or saw them in a result: ${unread.join(', ')}. Read them, or leave them out.`,
    );
  if (!links.some((u) => readKeys.has(normalizeUrl(u))))
    problems.push(
      'Your answer links no page you read. Add the link to the page each fact came from.',
    );
  if ((isFastFact(s.prompt) || isFastFact(answer)) && new Set(read.map(siteOf)).size < 2)
    problems.push(
      'This changes often and you read pages from one site only. Confirm it on a second, independent site. If they disagree, say so and give the newer one.',
    );
  return problems;
}

export const sourceGateMessage = (problems: string[]): string =>
  `${SOURCE_GATE_PREFIX}\n${problems.map((p) => `- ${p}`).join('\n')}`;

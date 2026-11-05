// What a search page gave back, before the model sees it. A search engine can answer an automated
// browser with popular pages that match one word of the query; those cost tokens and send the
// model into repeat searches, so they count as no result.
import type { SearchHit } from './port.ts';

/** Words that say little about what is being looked for. */
const COMMON = new Set(
  'a an and are at best by can do for from how i in is it me my of on or the this to top what when where which who why with year 2024 2025 2026 2027'.split(
    ' ',
  ),
);

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The query's words that should show up in a result. Filters such as `site:x` and `-word` are not. */
function queryWords(query: string): string[] {
  const bare = query
    .split(/\s+/)
    .filter((w) => !/^-|^[a-z]+:/i.test(w))
    .join(' ');
  return [...new Set(words(bare))].filter((w) => !COMMON.has(w));
}

/** Plurals and doubled letters ("cancelling", "canceling") compare equal. */
const stem = (w: string) => w.replace(/s$/, '').replace(/(.)\1/g, '$1');

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * The hits worth reading, in order: on the site a `site:` filter names, otherwise mentioning at
 * least half of what the query asks about.
 */
export function usefulHits(query: string, hits: SearchHit[]): SearchHit[] {
  const site = query.match(/(?:^|\s)site:(\S+)/i)?.[1]?.toLowerCase();
  if (site) return hits.filter((h) => `.${hostOf(h.url)}`.endsWith(`.${site}`));
  const wanted = queryWords(query).map(stem);
  if (!wanted.length) return hits;
  const need = Math.ceil(wanted.length / 2);
  return hits.filter((h) => {
    const text = words(`${h.title} ${h.url} ${h.snippet}`).map(stem).join(' ');
    return wanted.filter((w) => text.includes(w)).length >= need;
  });
}

/**
 * The query with its last meaningful word moved to the front, or null when there is nothing to
 * move. Bing sometimes reads only the first word of a query; this gives it a better first word.
 */
export function rephrased(query: string): string | null {
  const parts = query.trim().split(/\s+/);
  if (parts.length < 2 || parts.some((w) => /^-|^[a-z]+:/i.test(w))) return null;
  const at = parts.findLastIndex((w) => words(w).some((x) => !COMMON.has(x)));
  if (at < 1) return null;
  return [parts[at], ...parts.filter((_, i) => i !== at)].join(' ');
}

/**
 * The first engine with useful hits. One that fails or is blocked just passes to the next, so the
 * error only surfaces when every engine failed.
 */
export async function firstUseful(
  query: string,
  engines: (() => Promise<SearchHit[] | null>)[],
): Promise<SearchHit[]> {
  let failure: unknown;
  let answered = false;
  for (const engine of engines) {
    try {
      const hits = usefulHits(query, (await engine()) ?? []);
      answered = true;
      if (hits.length) return hits;
    } catch (e) {
      failure = e;
    }
  }
  if (!answered) throw failure;
  return [];
}

const MOVED = /Execution context was destroyed/;
const READS = 3;

/** Runs `read`, and when the page moved on underneath it, waits for it to settle and reads again. */
export async function rereadAfterNavigation<T>(
  read: () => Promise<T>,
  settle: () => Promise<void>,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (e) {
      if (i >= READS || !(e instanceof Error) || !MOVED.test(e.message)) throw e;
      await settle();
    }
  }
}

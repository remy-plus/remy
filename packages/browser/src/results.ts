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
 * The hits worth reading, in order: on the site a `site:` filter names, otherwise mentioning about
 * half of what the query asks about. Generous on purpose, since dropping a good page costs more
 * than keeping a weak one.
 */
export function usefulHits(query: string, hits: SearchHit[]): SearchHit[] {
  const site = query.match(/(?:^|\s)site:(\S+)/i)?.[1]?.toLowerCase();
  if (site) return hits.filter((h) => `.${hostOf(h.url)}`.endsWith(`.${site}`));
  const wanted = queryWords(query).map(stem);
  if (!wanted.length) return hits;
  const need = Math.max(1, Math.floor(wanted.length / 2));
  return hits.filter((h) => {
    const text = words(`${h.title} ${h.url} ${h.snippet}`).map(stem).join(' ');
    return wanted.filter((w) => text.includes(w)).length >= need;
  });
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

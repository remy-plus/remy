import { describe, expect, it } from 'vitest';
import { rereadAfterNavigation, usefulHits } from './results.ts';

const hit = (title: string, url = 'https://example.com/a', snippet = '') => ({
  title,
  url,
  snippet,
});

describe('usefulHits', () => {
  const query = 'best budget noise cancelling headphones 2026';

  it('drops pages that only match a common word', () => {
    const hits = [
      hit('Best Buy | Official Online Store', 'https://www.bestbuy.com/', 'Shop electronics'),
      hit('BEST Definition & Meaning', 'https://www.merriam-webster.com/dictionary/best'),
    ];
    expect(usefulHits(query, hits)).toEqual([]);
  });

  it('keeps pages about the question, in any spelling of the words', () => {
    const good = hit('The 4 Best Budget Noise-Canceling Headphones of 2026');
    const bad = hit('Best Buy | Official Online Store', 'https://www.bestbuy.com/');
    expect(usefulHits(query, [bad, good])).toEqual([good]);
  });

  it('counts the snippet and the address as well as the title', () => {
    const inSnippet = hit(
      'Our picks',
      'https://example.com/x',
      'budget headphones with noise control',
    );
    const inUrl = hit('Our picks', 'https://example.com/budget-noise-headphones');
    expect(usefulHits(query, [inSnippet, inUrl])).toEqual([inSnippet, inUrl]);
  });

  it('keeps only the site a site: filter names', () => {
    const q = 'site:nodejs.org Node.js latest stable version';
    const good = hit('Previous releases', 'https://www.nodejs.org/en/about');
    const bad = hit('Invest529 | My Account', 'https://www.invest529.com/');
    expect(usefulHits(q, [bad, good])).toEqual([good]);
  });

  it('keeps everything when the query has no word to check', () => {
    const hits = [hit('Anything')];
    expect(usefulHits('the best of', hits)).toEqual(hits);
  });

  it('checks queries in other alphabets', () => {
    const good = hit('Лучшие наушники');
    expect(usefulHits('лучшие наушники', [good, hit('Best Buy')])).toEqual([good]);
  });
});

describe('rereadAfterNavigation', () => {
  const gone = new Error(
    'page.evaluate: Execution context was destroyed, most likely because of a navigation',
  );

  it('reads again after the page moved on mid-read', async () => {
    let reads = 0;
    let settled = 0;
    const got = await rereadAfterNavigation(
      async () => {
        if (++reads === 1) throw gone;
        return 'hits';
      },
      async () => {
        settled++;
      },
    );
    expect(got).toBe('hits');
    expect([reads, settled]).toEqual([2, 1]);
  });

  it('gives up after a few tries', async () => {
    let reads = 0;
    const read = rereadAfterNavigation(
      async () => {
        reads++;
        throw gone;
      },
      async () => {},
    );
    await expect(read).rejects.toThrow(/Execution context/);
    expect(reads).toBe(3);
  });

  it('passes other errors straight on', async () => {
    let reads = 0;
    const read = rereadAfterNavigation(
      async () => {
        reads++;
        throw new Error('Timeout');
      },
      async () => {},
    );
    await expect(read).rejects.toThrow('Timeout');
    expect(reads).toBe(1);
  });
});

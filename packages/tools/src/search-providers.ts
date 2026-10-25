import type { SearchProvider, SearchResult } from './web.ts';

async function json(res: Response, name: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

type Row = Record<string, string | undefined>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const toResult = (r: Row, snippet: string | undefined): SearchResult => ({
  title: r.title ?? '',
  url: r.url ?? '',
  snippet: snippet ?? '',
});

export function braveSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const u = new URL('https://api.search.brave.com/res/v1/web/search');
      u.searchParams.set('q', query);
      u.searchParams.set('count', String(count));
      const data = await json(
        await fetch(u, { headers: { accept: 'application/json', 'x-subscription-token': apiKey } }),
        'Brave Search',
      );
      return rows((data.web as { results?: unknown } | undefined)?.results).map((r) =>
        toResult(r, r.description),
      );
    },
  };
}

export function tavilySearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const data = await json(
        await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query, max_results: count }),
        }),
        'Tavily',
      );
      return rows(data.results).map((r) => toResult(r, r.content));
    },
  };
}

export function searxngSearch(baseUrl: string): SearchProvider {
  return {
    async search(query, count) {
      const u = new URL('search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      const data = await json(
        await fetch(u, { headers: { accept: 'application/json' } }),
        'SearXNG',
      );
      return rows(data.results)
        .slice(0, count)
        .map((r) => toResult(r, r.content));
    },
  };
}

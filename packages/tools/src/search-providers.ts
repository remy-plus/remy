import { type SearchProvider, type SearchResult, SearchUnavailable } from './web.ts';

async function json(res: Response, name: string): Promise<Record<string, unknown>> {
  if (res.status === 401 || res.status === 403)
    throw new SearchUnavailable(`${name} refused the key (HTTP ${res.status}).`);
  if (res.status === 402) throw new SearchUnavailable(`${name} is out of credit (HTTP 402).`);
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

export function tinyfishSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const u = new URL('https://api.search.tinyfish.ai');
      u.searchParams.set('query', query);
      const data = await json(
        await fetch(u, { headers: { accept: 'application/json', 'x-api-key': apiKey } }),
        'TinyFish',
      );
      return rows(data.results)
        .slice(0, count)
        .map((r) => toResult(r, r.snippet));
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

/** Context.dev web search (https://docs.context.dev/search/overview). */
export function contextDevSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const data = await json(
        await fetch('https://api.context.dev/v1/web/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query, numResults: count, descriptionMaxCharacters: 300 }),
        }),
        'Context.dev',
      );
      return rows(data.results).map((r) => toResult(r, r.description));
    },
  };
}

const post = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
): [string, RequestInit] => [
  url,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  },
];

const bearer = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });
const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim();

/** Exa (https://docs.exa.ai/reference/search): the first 500 characters of each page as the snippet. */
export function exaSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const [url, init] = post(
        'https://api.exa.ai/search',
        { 'x-api-key': apiKey },
        { query, numResults: count, type: 'auto', contents: { text: { maxCharacters: 500 } } },
      );
      const data = await json(await fetch(url, init), 'Exa');
      return rows(data.results)
        .slice(0, count)
        .map((r) => {
          const hl = (r as { highlights?: unknown }).highlights;
          const fromHighlights = Array.isArray(hl) ? hl.join(' ') : undefined;
          return toResult(r, clean(r.text) || clean(fromHighlights));
        });
    },
  };
}

/** Perplexity Search API (https://docs.perplexity.ai/api-reference/search-post). */
export function perplexitySearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const [url, init] = post('https://api.perplexity.ai/search', bearer(apiKey), {
        query,
        max_results: count,
      });
      const data = await json(await fetch(url, init), 'Perplexity');
      return rows(data.results)
        .slice(0, count)
        .map((r) => toResult(r, r.snippet));
    },
  };
}

/** Linkup (https://docs.linkup.so/pages/documentation/api-reference/endpoint/post-search). */
export function linkupSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const [url, init] = post('https://api.linkup.so/v1/search', bearer(apiKey), {
        q: query,
        depth: 'standard',
        outputType: 'searchResults',
        maxResults: count,
      });
      const data = await json(await fetch(url, init), 'Linkup');
      return rows(data.results)
        .filter((r) => r.type !== 'image')
        .slice(0, count)
        .map((r) => toResult({ ...r, title: r.name ?? r.title }, r.content));
    },
  };
}

/** Serper, Google results (https://serper.dev). */
export function serperSearch(apiKey: string): SearchProvider {
  return {
    async search(query, count) {
      const [url, init] = post(
        'https://google.serper.dev/search',
        { 'x-api-key': apiKey },
        { q: query, num: count },
      );
      const data = await json(await fetch(url, init), 'Serper');
      return rows(data.organic)
        .slice(0, count)
        .map((r) => toResult({ ...r, url: r.link }, r.snippet));
    },
  };
}

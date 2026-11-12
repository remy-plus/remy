import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contextDevSearch,
  exaSearch,
  linkupSearch,
  perplexitySearch,
  serperSearch,
  tinyfishSearch,
} from './search-providers.ts';
import { SearchUnavailable } from './web.ts';

afterEach(() => vi.restoreAllMocks());

describe('contextDevSearch', () => {
  it('posts the query with the key and maps title, url and description', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        query: 'rye',
        results: [
          { title: 'Rye bread', url: 'https://rye.test', description: 'A dark loaf.' },
          { title: 'No snippet', url: 'https://b.test', description: '' },
        ],
      }),
    );
    const hits = await contextDevSearch('ctx-key').search('rye', 2);
    expect(hits).toEqual([
      { title: 'Rye bread', url: 'https://rye.test', snippet: 'A dark loaf.' },
      { title: 'No snippet', url: 'https://b.test', snippet: '' },
    ]);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.context.dev/v1/web/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ctx-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'rye', numResults: 2 });
  });

  it('reports an HTTP error plainly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
    const err = await contextDevSearch('bad')
      .search('x', 1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SearchUnavailable);
    expect((err as Error).message).toBe('Context.dev refused the key (HTTP 401).');
  });

  it('reads 402 as out of credit and 500 as a passing failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 402 }));
    await expect(contextDevSearch('k').search('x', 1)).rejects.toBeInstanceOf(SearchUnavailable);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    const err = await contextDevSearch('k')
      .search('x', 1)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SearchUnavailable);
  });
});

describe('tinyfishSearch', () => {
  it('sends the query with the key and keeps to the count asked for', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        query: 'rye',
        results: [
          { position: 1, title: 'Rye bread', url: 'https://rye.test', snippet: 'A dark loaf.' },
          { position: 2, title: 'Rye flour', url: 'https://flour.test', snippet: 'Milled.' },
          { position: 3, title: 'Rye grass', url: 'https://grass.test', snippet: 'A lawn.' },
        ],
      }),
    );
    const hits = await tinyfishSearch('tf-key').search('rye bread', 2);
    expect(hits).toEqual([
      { title: 'Rye bread', url: 'https://rye.test', snippet: 'A dark loaf.' },
      { title: 'Rye flour', url: 'https://flour.test', snippet: 'Milled.' },
    ]);
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.search.tinyfish.ai/?query=rye+bread');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('tf-key');
  });

  it('reports an HTTP error plainly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
    await expect(tinyfishSearch('bad').search('x', 1)).rejects.toThrow(
      'TinyFish refused the key (HTTP 401)',
    );
  });
});

describe('keyed search services', () => {
  const sent = (f: { mock: { calls: unknown[][] } }) => {
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    return {
      url,
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    };
  };

  it('Exa sends x-api-key and maps text, falling back to highlights', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        results: [
          { title: 'A', url: 'https://a.test', text: 'line one\n  line two' },
          { title: 'B', url: 'https://b.test', highlights: ['h1', 'h2'] },
        ],
      }),
    );
    expect(await exaSearch('k').search('q', 2)).toEqual([
      { title: 'A', url: 'https://a.test', snippet: 'line one line two' },
      { title: 'B', url: 'https://b.test', snippet: 'h1 h2' },
    ]);
    const r = sent(f);
    expect(r.url).toBe('https://api.exa.ai/search');
    expect(r.headers['x-api-key']).toBe('k');
    expect(r.body).toEqual({
      query: 'q',
      numResults: 2,
      type: 'auto',
      contents: { text: { maxCharacters: 500 } },
    });
  });

  it('Perplexity sends a bearer key and maps snippet', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ results: [{ title: 'P', url: 'https://p.test', snippet: 'sn' }] }),
      );
    expect(await perplexitySearch('k').search('q', 3)).toEqual([
      { title: 'P', url: 'https://p.test', snippet: 'sn' },
    ]);
    const r = sent(f);
    expect(r.url).toBe('https://api.perplexity.ai/search');
    expect(r.headers.authorization).toBe('Bearer k');
    expect(r.body).toEqual({ query: 'q', max_results: 3 });
  });

  it('Linkup maps name and content and drops images', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        results: [
          { type: 'text', name: 'L', url: 'https://l.test', content: 'body' },
          { type: 'image', name: 'pic', url: 'https://l.test/i.png' },
        ],
      }),
    );
    expect(await linkupSearch('k').search('q', 5)).toEqual([
      { title: 'L', url: 'https://l.test', snippet: 'body' },
    ]);
    const r = sent(f);
    expect(r.url).toBe('https://api.linkup.so/v1/search');
    expect(r.headers.authorization).toBe('Bearer k');
    expect(r.body).toEqual({
      q: 'q',
      depth: 'standard',
      outputType: 'searchResults',
      maxResults: 5,
    });
  });

  it('Serper maps organic title, link and snippet', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ organic: [{ title: 'S', link: 'https://s.test', snippet: 'x' }] }),
      );
    expect(await serperSearch('k').search('q', 4)).toEqual([
      { title: 'S', url: 'https://s.test', snippet: 'x' },
    ]);
    const r = sent(f);
    expect(r.url).toBe('https://google.serper.dev/search');
    expect(r.headers['x-api-key']).toBe('k');
    expect(r.body).toEqual({ q: 'q', num: 4 });
  });

  it.each([
    ['Exa', exaSearch],
    ['Perplexity', perplexitySearch],
    ['Linkup', linkupSearch],
    ['Serper', serperSearch],
  ])('%s maps 401 to a refused key and 402 to out of credit', async (name, make) => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(new Response('', { status: 401 }));
    const a = await make('k')
      .search('q', 1)
      .catch((e: unknown) => e);
    expect(a).toBeInstanceOf(SearchUnavailable);
    expect((a as Error).message).toBe(`${name} refused the key (HTTP 401).`);
    f.mockResolvedValueOnce(new Response('', { status: 402 }));
    const b = await make('k')
      .search('q', 1)
      .catch((e: unknown) => e);
    expect(b).toBeInstanceOf(SearchUnavailable);
    expect((b as Error).message).toBe(`${name} is out of credit (HTTP 402).`);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextDevSearch, tinyfishSearch } from './search-providers.ts';
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

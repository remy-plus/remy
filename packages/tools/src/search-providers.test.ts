import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextDevSearch } from './search-providers.ts';

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
    await expect(contextDevSearch('bad').search('x', 1)).rejects.toThrow(
      'Context.dev returned HTTP 401',
    );
  });
});

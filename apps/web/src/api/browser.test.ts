import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApi } from './http.ts';
import { createMockApi } from './mock.ts';

afterEach(() => vi.unstubAllGlobals());

describe('browser api', () => {
  it('mock: an open browser with a state and an inline frame', async () => {
    const api = createMockApi();
    expect(await api.browserState()).toMatchObject({
      open: true,
      url: expect.stringContaining('https://'),
      title: expect.any(String),
    });
    expect(await api.browserFrame()).toMatch(/^data:image\/svg\+xml/);
  });

  it('http: reads the state with the bearer token', async () => {
    const fetcher = vi.fn(
      async () => new Response('{"open":true,"url":"https://a.test","title":"A"}', { status: 200 }),
    );
    const api = createHttpApi({ token: () => 'secret', fetch: fetcher as unknown as typeof fetch });
    expect(await api.browserState()).toEqual({ open: true, url: 'https://a.test', title: 'A' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/browser/state');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
  });

  it('http: the frame is an object URL fetched with the token; 204 is null', async () => {
    const create = vi.fn(() => 'blob:frame/1');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(['jpg'], { type: 'image/jpeg' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createHttpApi({ token: () => 'secret', fetch: fetcher as unknown as typeof fetch });
    expect(await api.browserFrame()).toBe('blob:frame/1');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/browser/frame');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
    expect(await api.browserFrame()).toBeNull();
    expect(create).toHaveBeenCalledOnce();
  });
});

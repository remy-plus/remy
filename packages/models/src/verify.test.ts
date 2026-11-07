import { describe, expect, it } from 'vitest';
import { verifyKey } from './verify.ts';

function recorder(status: number) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe('verifyKey', () => {
  it('asks a model when the provider lists models to anyone', async () => {
    const { seen, fetchImpl } = recorder(401);
    const r = await verifyKey({
      baseUrl: 'https://api.example.test/v1',
      key: 'bad',
      chatModel: 'small-model',
      fetchImpl,
    });
    expect(r).toBe('rejected');
    expect(seen[0]?.url).toBe('https://api.example.test/v1/chat/completions');
  });

  it('reads a 400 that says the key is bad as a refusal, as xAI answers', async () => {
    const answer = (body: string) =>
      (async () => new Response(body, { status: 400 })) as unknown as typeof fetch;
    const check = (body: string) =>
      verifyKey({ baseUrl: 'https://api.x.ai/v1', key: 'bad', fetchImpl: answer(body) });
    expect(await check('{"error":"Incorrect API key provided"}')).toBe('rejected');
    expect(await check('{"error":"bad request"}')).toBe('unreachable');
  });

  it('checks an OpenRouter key on its key endpoint, which refuses a made-up key', async () => {
    const { seen, fetchImpl } = recorder(401);
    const r = await verifyKey({
      baseUrl: 'https://openrouter.ai/api/v1/',
      key: 'sk-or-bogus',
      fetchImpl,
    });
    expect(r).toBe('rejected');
    expect(seen[0]?.url).toBe('https://openrouter.ai/api/v1/key');
    expect(seen[0]?.headers.authorization).toBe('Bearer sk-or-bogus');
  });

  it('lists models elsewhere, and never puts the key in the URL', async () => {
    const { seen, fetchImpl } = recorder(200);
    expect(await verifyKey({ baseUrl: 'https://api.openai.com/v1', key: 'sk-1', fetchImpl })).toBe(
      'ok',
    );
    expect(
      await verifyKey({ kind: 'google', baseUrl: 'https://g.test/v1beta', key: 'g-1', fetchImpl }),
    ).toBe('ok');
    expect(seen.map((s) => s.url)).toEqual([
      'https://api.openai.com/v1/models',
      'https://g.test/v1beta/models?pageSize=1',
    ]);
    expect(seen.every((s) => !s.url.includes('sk-1') && !s.url.includes('g-1'))).toBe(true);
  });

  it('tells a rejected key from an unreachable server', async () => {
    expect(await verifyKey({ baseUrl: 'https://x.test', key: 'k', ...recorder(403) })).toBe(
      'rejected',
    );
    expect(
      await verifyKey({ kind: 'google', baseUrl: 'https://x.test', key: 'k', ...recorder(400) }),
    ).toBe('rejected');
    expect(await verifyKey({ baseUrl: 'https://x.test', key: 'k', ...recorder(500) })).toBe(
      'unreachable',
    );
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await verifyKey({ baseUrl: 'https://x.test', key: 'k', fetchImpl: down })).toBe(
      'unreachable',
    );
  });
});

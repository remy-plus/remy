import { type ModelCaps, ModelError } from '@remy/core';
import { describe, expect, it } from 'vitest';
import {
  cachedTokens,
  createOpenAIClient,
  REASONING_MIN_OUTPUT_TOKENS,
  retryAfterMs,
  withRouterCacheBreaks,
} from './openai.ts';
import type { RawRequest } from './types.ts';

const caps: ModelCaps = {
  nativeTools: true,
  jsonSchema: false,
  contextTokens: 8000,
  pricing: { inPerMTok: 0, outPerMTok: 0 },
};
const req: RawRequest = {
  system: 'sys',
  messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'ok', calls: [{ callId: 'c1', tool: 'read', args: { p: 1 } }] },
    { role: 'tool', callId: 'c1', tool: 'read', content: 'data' },
  ],
  tools: [{ name: 'read', description: 'd', parameters: { type: 'object' } }],
  maxOutputTokens: 100,
  temperature: 0.2,
};
const sig = () => new AbortController().signal;

function make(handler: (url: string, init: RequestInit) => Response | Promise<Response>, id = 'm') {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const client = createOpenAIClient({
    id,
    baseUrl: 'http://x/v1/',
    apiKey: 'k',
    caps,
    headers: { 'x-a': 'b' },
    fetchImpl,
  });
  return { client, seen };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const hangUntilAbort = ((_u: string, init: RequestInit) =>
  new Promise((_r, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as unknown as typeof fetch;

describe('createOpenAIClient', () => {
  it('maps the request to OpenAI format', async () => {
    const { client, seen } = make(() => json({ choices: [{ message: { content: 'x' } }] }));
    const withFormat: RawRequest = { ...req, responseFormat: { type: 'json_object' } };
    await client.complete(withFormat, sig());
    const s = seen[0];
    expect(s?.url).toBe('http://x/v1/chat/completions');
    const headers = s?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer k');
    expect(headers['x-a']).toBe('b');
    const body = JSON.parse(s?.init.body as string);
    expect(body.model).toBe('m');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'read', description: 'd', parameters: { type: 'object' } },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'ok',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read', arguments: '{"p":1}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'data' },
    ]);
  });

  it.each(['gpt-5-nano', 'openai/gpt-5-nano', 'o3-mini'])(
    'sends reasoning-model parameters for %s',
    async (id) => {
      const { client, seen } = make(() => json({ choices: [{ message: { content: 'x' } }] }), id);
      await client.complete(req, sig());
      const body = JSON.parse(seen[0]?.init.body as string);
      expect(body.max_completion_tokens).toBe(REASONING_MIN_OUTPUT_TOKENS);
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('temperature');
    },
  );

  it('reports an empty reply cut off by the output limit as retryable', async () => {
    const { client } = make(() =>
      json({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    );
    const err = await client.complete(req, sig()).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/output limit/);
  });

  it('keeps max_tokens and temperature for ordinary models', async () => {
    const { client, seen } = make(
      () => json({ choices: [{ message: { content: 'x' } }] }),
      'openai/gpt-4o-mini',
    );
    await client.complete(req, sig());
    const body = JSON.parse(seen[0]?.init.body as string);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.2);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('parses text, tool calls and usage', async () => {
    const { client } = make(() =>
      json({
        choices: [
          {
            message: {
              content: 'hello',
              tool_calls: [
                { id: 'a', function: { name: 'read', arguments: '{"p":"f"}' } },
                { id: 'b', function: { name: 'read', arguments: '{oops' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
    const r = await client.complete(req, sig());
    expect(r.text).toBe('hello');
    expect(r.calls).toEqual([
      { tool: 'read', args: { p: 'f' } },
      { tool: 'read', args: '{oops' },
    ]);
    expect(r.usage).toEqual({ inTokens: 10, outTokens: 5 });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
  ])('HTTP %i -> retryable=%s', async (status, retryable) => {
    const { client } = make(() => new Response('nope', { status }));
    const err = await client.complete(req, sig()).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(retryable);
  });

  it('a 429 is a rate limit and carries the wait the provider asked for', async () => {
    const { client } = make(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
    );
    const err = await client.complete(req, sig()).catch((e) => e);
    expect(err).toMatchObject({ retryable: true, rateLimited: true, retryAfterMs: 7000 });
  });

  it('flags a request that is over the provider limit, not just a busy key', async () => {
    const body = (status: number, message: string) =>
      new Response(JSON.stringify({ error: { message } }), { status });
    const run = async (r: Response) =>
      make(() => r)
        .client.complete(req, sig())
        .catch((e) => e);
    expect(
      await run(body(413, 'Request too large for model. Limit 8000, Requested 17786')),
    ).toMatchObject({
      tooLarge: true,
      retryable: false,
    });
    expect(
      await run(
        body(
          429,
          'Rate limit reached: tokens per minute (TPM): Limit 8000, Used 0, Requested 17786',
        ),
      ),
    ).toMatchObject({ tooLarge: true, rateLimited: true });
    expect(
      await run(
        body(
          429,
          'Rate limit reached: tokens per minute (TPM): Limit 8000, Used 7000, Requested 2000',
        ),
      ),
    ).toMatchObject({ tooLarge: false, rateLimited: true });
  });

  it('reads Retry-After as seconds or a date, else X-RateLimit-Reset in seconds or ms', () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    const at = (h: Record<string, string>) => retryAfterMs(new Headers(h), now);
    expect(at({ 'retry-after': '3' })).toBe(3000);
    expect(at({ 'retry-after': 'Tue, 27 Oct 2026 00:00:10 GMT' })).toBe(10_000);
    expect(at({ 'x-ratelimit-reset': String(now / 1000 + 20) })).toBe(20_000);
    expect(at({ 'x-ratelimit-reset': String(now + 4000) })).toBe(4000);
    expect(at({})).toBeUndefined();
  });

  it('network errors are retryable', async () => {
    const { client } = make(() => {
      throw new TypeError('fetch failed');
    });
    const err = await client.complete(req, sig()).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(true);
  });

  it('times out as retryable', async () => {
    const client = createOpenAIClient({
      id: 'm',
      baseUrl: 'http://x',
      caps,
      timeoutMs: 10,
      fetchImpl: hangUntilAbort,
    });
    const err = await client.complete(req, sig()).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/timed out/);
  });

  it('honors the abort signal as non-retryable', async () => {
    const ac = new AbortController();
    const client = createOpenAIClient({
      id: 'm',
      baseUrl: 'http://x',
      caps,
      fetchImpl: hangUntilAbort,
    });
    const p = client.complete(req, ac.signal);
    ac.abort();
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(false);
  });
});

describe('cachedTokens', () => {
  it('reads OpenAI-style and DeepSeek-style cache hits', () => {
    expect(cachedTokens({ prompt_tokens_details: { cached_tokens: 1024 } })).toEqual({
      cachedInTokens: 1024,
    });
    expect(cachedTokens({ prompt_cache_hit_tokens: 512 })).toEqual({ cachedInTokens: 512 });
  });

  it('is empty when nothing was cached or nothing was said', () => {
    expect(cachedTokens({})).toEqual({});
    expect(cachedTokens({ prompt_tokens_details: { cached_tokens: 0 } })).toEqual({});
  });
});

describe('withRouterCacheBreaks', () => {
  it('marks the system prompt and the last message', () => {
    const out = withRouterCacheBreaks([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'U2' },
    ]);
    const mark = { type: 'ephemeral' };
    expect(out[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'S', cache_control: mark }],
    });
    expect(out[1]).toEqual({ role: 'user', content: 'U1' });
    expect(out[3]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'U2', cache_control: mark }],
    });
  });

  it('leaves a last message without text alone', () => {
    const call = { role: 'assistant', content: null, tool_calls: [] };
    expect(withRouterCacheBreaks([call])).toEqual([call]);
  });
});

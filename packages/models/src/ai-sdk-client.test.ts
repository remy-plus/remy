import { ModelError, type ModelRequest } from '@remy/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiSdkClient } from './ai-sdk-client.ts';
import { BUILTIN_CATALOG, resolveCaps } from './catalog.ts';
import { modelFromEnv, PROFILES } from './config.ts';
import { withNativeTools } from './native.ts';

afterEach(() => vi.unstubAllGlobals());

const sse = (events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
const dataOnly = (chunks: unknown[]) =>
  new Response(chunks.map((d) => `data: ${JSON.stringify(d)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const request: ModelRequest = {
  system: 'Be brief.',
  messages: [{ role: 'user', content: 'finish with hi' }],
  tools: [
    {
      name: 'finish',
      description: 'Finish the task',
      parameters: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
    },
  ],
  maxOutputTokens: 1000,
  temperature: 0,
};
const never = new AbortController().signal;

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}
function transport(respond: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return respond();
  }) as typeof fetch;
  return { sent, fetchImpl };
}

const claudeReply = () =>
  sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 40, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Considering.' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'On it.' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 1 }],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'finish', input: {} },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"answer":"hi"}' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 2 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 25 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);

const caps = resolveCaps('claude-sonnet-5-5', BUILTIN_CATALOG);

describe('Anthropic through the AI SDK client', () => {
  it('sends a native request and reads text, reasoning, tool call and usage', async () => {
    const t = transport(claudeReply);
    const client = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: t.fetchImpl,
    });
    const text: string[] = [];
    const reasoning: string[] = [];
    const res = await client.complete(
      request,
      never,
      (d) => text.push(d),
      (d) => reasoning.push(d),
    );
    expect(res).toEqual({
      text: 'On it.',
      calls: [{ tool: 'finish', args: { answer: 'hi' } }],
      usage: { inTokens: 40, outTokens: 25 },
    });
    expect(text.join('')).toBe('On it.');
    expect(reasoning.join('')).toBe('Considering.');
    const sent = t.sent[0] as Sent;
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.headers.get('x-api-key')).toBe('sk-ant-test-0001');
    expect(sent.body.model).toBe('claude-sonnet-5-5');
    expect(sent.body.max_tokens).toBe(8192);
    expect(sent.body.temperature).toBeUndefined();
    expect(JSON.stringify(sent.body.system)).toContain('Be brief.');
    expect((sent.body.tools as { name: string }[])[0]?.name).toBe('finish');
    expect(sent.body.thinking).toMatchObject({ type: 'adaptive', display: 'summarized' });
  });

  it('sends tool results back grouped, and works with the native-tools strategy', async () => {
    const t = transport(claudeReply);
    const raw = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: t.fetchImpl,
    });
    const res = await withNativeTools(raw).complete(
      {
        ...request,
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            calls: [
              { callId: 'c1', tool: 'finish', args: { answer: 'a' } },
              { callId: 'c2', tool: 'finish', args: { answer: 'b' } },
            ],
          },
          { role: 'tool', callId: 'c1', tool: 'finish', content: 'one' },
          { role: 'tool', callId: 'c2', tool: 'finish', content: 'two' },
        ],
      },
      never,
    );
    expect(res.calls[0]?.tool).toBe('finish');
    const msgs = (t.sent[0] as Sent).body.messages as { role: string; content: unknown[] }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[2]?.content).toHaveLength(2);
  });

  it.each([
    [429, true, true],
    [529, true, false],
    [500, true, false],
    [400, false, false],
    [401, false, false],
  ])('maps HTTP %i to retryable=%s rateLimited=%s', async (status, retryable, limited) => {
    const t = transport(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'nope' } }), {
          status,
          headers: { 'retry-after': '7' },
        }),
    );
    const client = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: t.fetchImpl,
    });
    const err = (await client.complete(request, never).catch((e) => e)) as ModelError;
    expect(err).toBeInstanceOf(ModelError);
    expect(err.message).toContain(`HTTP ${status}`);
    expect(err.retryable).toBe(retryable);
    expect(err.rateLimited).toBe(limited);
    if (limited) expect(err.retryAfterMs).toBe(7000);
    expect(t.sent).toHaveLength(1); // the SDK does not retry behind our back
  });

  it('reports an abort as not retryable and a dropped connection as retryable', async () => {
    const ctl = new AbortController();
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        if (init?.signal?.aborted) reject(new Error('aborted'));
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const client = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: slow,
    });
    const pending = client.complete(request, ctl.signal).catch((e) => e);
    ctl.abort();
    const aborted = (await pending) as ModelError;
    expect(aborted.message).toBe('request aborted');
    expect(aborted.retryable).toBe(false);

    const down = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-sonnet-5-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    const err = (await down.complete(request, never).catch((e) => e)) as ModelError;
    expect(err.retryable).toBe(true);
  });

  it('does not ask older Claude models for adaptive thinking', async () => {
    const t = transport(claudeReply);
    const client = createAiSdkClient({
      kind: 'anthropic',
      id: 'claude-haiku-4-5',
      apiKey: 'sk-ant-test-0001',
      caps,
      fetchImpl: t.fetchImpl,
    });
    await client.complete(
      request,
      never,
      () => {},
      () => {},
    );
    expect((t.sent[0] as Sent).body.thinking).toBeUndefined();
  });
});

describe('Gemini through the AI SDK client', () => {
  const geminiReply = () =>
    dataOnly([
      {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Thinking it over.', thought: true }] } },
        ],
      },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Sure.' }] } }] },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'finish', args: { answer: 'hi' } } }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 },
      },
    ]);

  it('sends a native request and reads text, thoughts, tool call and usage', async () => {
    const t = transport(geminiReply);
    const client = createAiSdkClient({
      kind: 'google',
      id: 'gemini-2.5-flash',
      apiKey: 'AIza-test-0001',
      caps: resolveCaps('gemini-2.5-flash', BUILTIN_CATALOG),
      fetchImpl: t.fetchImpl,
    });
    const reasoning: string[] = [];
    const res = await client.complete(
      request,
      never,
      () => {},
      (d) => reasoning.push(d),
    );
    expect(res.text).toBe('Sure.');
    expect(res.calls).toEqual([{ tool: 'finish', args: { answer: 'hi' } }]);
    expect(res.usage).toEqual({ inTokens: 30, outTokens: 12 });
    expect(reasoning.join('')).toBe('Thinking it over.');
    const sent = t.sent[0] as Sent;
    expect(sent.url).toContain('/models/gemini-2.5-flash:streamGenerateContent');
    expect(sent.headers.get('x-goog-api-key')).toBe('AIza-test-0001');
    expect(sent.url).not.toContain('AIza-test-0001');
    const config = sent.body.generationConfig as Record<string, unknown>;
    expect(config.maxOutputTokens).toBe(8192);
    expect(config.temperature).toBe(0);
    expect(JSON.stringify(sent.body.tools)).toContain('finish');
  });

  it('leaves temperature alone on Gemini 3 and later', async () => {
    const t = transport(geminiReply);
    const client = createAiSdkClient({
      kind: 'google',
      id: 'gemini-3.8-flash',
      apiKey: 'AIza-test-0001',
      caps: resolveCaps('gemini-3.8-flash', BUILTIN_CATALOG),
      fetchImpl: t.fetchImpl,
    });
    await client.complete(request, never);
    const config = ((t.sent[0] as Sent).body.generationConfig ?? {}) as Record<string, unknown>;
    expect(config.temperature).toBeUndefined();
  });
});

describe('profiles and catalog', () => {
  it('wires the anthropic and google profiles to their key variables', () => {
    expect(PROFILES.anthropic).toMatchObject({ kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY' });
    expect(PROFILES.google).toMatchObject({ kind: 'google', keyEnv: 'GEMINI_API_KEY' });
  });

  it('builds a client from the profile and talks to the native endpoint', async () => {
    const t = transport(claudeReply);
    vi.stubGlobal('fetch', t.fetchImpl);
    const client = modelFromEnv({
      REMY_PROFILE: 'anthropic',
      REMY_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_API_KEY: 'sk-ant-test-0001',
    });
    expect(client.caps.pricing).toEqual({ inPerMTok: 2, outPerMTok: 10, cachedInPerMTok: 0.2 });
    expect(client.caps.contextWindow).toBe(1_000_000);
    const res = await client.complete(request, never);
    expect(res.calls[0]?.tool).toBe('finish');
    expect((t.sent[0] as Sent).url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('needs a key for native providers', () => {
    expect(() => modelFromEnv({ REMY_PROFILE: 'google', REMY_MODEL: 'gemini-2.5-flash' })).toThrow(
      'GEMINI_API_KEY',
    );
  });

  it('prices the shipped models', () => {
    for (const id of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-haiku-4-5',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ])
      expect(resolveCaps(id).pricing.outPerMTok, id).toBeGreaterThan(0);
  });
});

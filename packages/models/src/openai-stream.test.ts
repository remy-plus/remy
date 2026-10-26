import { type ModelCaps, ModelError } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { createOpenAIClient } from './openai.ts';
import type { RawRequest } from './types.ts';

const caps: ModelCaps = {
  nativeTools: true,
  jsonSchema: false,
  contextTokens: 8000,
  pricing: { inPerMTok: 0, outPerMTok: 0 },
};
const req: RawRequest = {
  system: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ name: 'read', description: 'd', parameters: { type: 'object' } }],
  maxOutputTokens: 100,
  temperature: 0.2,
};
const sig = () => new AbortController().signal;

function make(handler: (init: RequestInit) => Response) {
  const seen: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return handler(init);
  }) as unknown as typeof fetch;
  return { client: createOpenAIClient({ id: 'm', baseUrl: 'http://x/v1', caps, fetchImpl }), seen };
}

/** An SSE response whose body arrives in the given raw pieces. */
const sse = (...pieces: string[]) => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of pieces) c.enqueue(enc.encode(p));
        c.close();
      },
    }),
  );
};
const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const toolDelta = (index: number, fn: Record<string, string>, id?: string) =>
  chunk({ choices: [{ delta: { tool_calls: [{ index, ...(id && { id }), function: fn }] } }] });

describe('createOpenAIClient streaming', () => {
  it('requests a stream with usage and accumulates split text chunks', async () => {
    const full =
      chunk({ choices: [{ delta: { content: 'Hel' } }] }) +
      chunk({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }) +
      chunk({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }) +
      'data: [DONE]\n\n';
    // Cut mid-line so a data line spans two reads.
    const { client, seen } = make(() => sse(full.slice(0, 25), full.slice(25, 90), full.slice(90)));
    const deltas: string[] = [];
    const res = await client.complete(req, sig(), (d) => deltas.push(d));
    const body = JSON.parse(seen[0]?.body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(res).toEqual({ text: 'Hello', calls: [], usage: { inTokens: 7, outTokens: 2 } });
  });

  it('does not stream without a text callback', async () => {
    const { client, seen } = make(
      () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] })),
    );
    await client.complete(req, sig());
    expect(JSON.parse(seen[0]?.body as string).stream).toBeUndefined();
  });

  it('assembles tool-call fragments by index', async () => {
    const { client } = make(() =>
      sse(
        toolDelta(0, { name: 'rea', arguments: '' }, 'a'),
        toolDelta(0, { name: 'd', arguments: '{"p"' }),
        toolDelta(1, { name: 'x', arguments: '{}' }),
        toolDelta(0, { arguments: ':1}' }),
        chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ),
    );
    const deltas: string[] = [];
    const res = await client.complete(req, sig(), (d) => deltas.push(d));
    expect(res.calls).toEqual([
      { tool: 'read', args: { p: 1 } },
      { tool: 'x', args: {} },
    ]);
    expect(deltas).toEqual([]);
  });

  it('still errors on an empty reply cut off at the length limit', async () => {
    const { client } = make(() =>
      sse(chunk({ choices: [{ delta: {}, finish_reason: 'length' }] })),
    );
    await expect(client.complete(req, sig(), () => {})).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('reports HTTP errors as before', async () => {
    const { client } = make(() => new Response('busy', { status: 503 }));
    await expect(client.complete(req, sig(), () => {})).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('turns an abort mid-stream into a non-retryable ModelError', async () => {
    const ctl = new AbortController();
    const enc = new TextEncoder();
    const { client } = make(
      (init) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(chunk({ choices: [{ delta: { content: 'a' } }] })));
              init.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
            },
          }),
        ),
    );
    const err = await client.complete(req, ctl.signal, () => ctl.abort()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).retryable).toBe(false);
  });
});

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

describe('reasoning summaries', () => {
  it('forwards the reasoning fields providers send, and keeps them out of the response', async () => {
    const full =
      chunk({ choices: [{ delta: { reasoning: '**Checking files** ' } }] }) +
      chunk({ choices: [{ delta: { reasoning_content: 'then moving.' } }] }) +
      chunk({ choices: [{ delta: { reasoning_details: [{ summary: 'more' }] } }] }) +
      chunk({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n';
    const { client } = make(() => sse(full));
    const thoughts: string[] = [];
    const res = await client.complete(
      req,
      sig(),
      () => {},
      (d) => thoughts.push(d),
    );
    expect(thoughts).toEqual(['**Checking files** ', 'then moving.', 'more']);
    expect(res.text).toBe('Done');
    expect(JSON.stringify(res)).not.toContain('Checking');
  });

  it('shows nothing when the provider sends no reasoning', async () => {
    const { client } = make(() =>
      sse(chunk({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] })),
    );
    const thoughts: string[] = [];
    await client.complete(
      req,
      sig(),
      () => {},
      (d) => thoughts.push(d),
    );
    expect(thoughts).toEqual([]);
  });
});

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

  it('does not hand back half an answer when the stream ends without finishing', async () => {
    const { client } = make(() =>
      sse(chunk({ choices: [{ delta: { content: 'The answer is' } }] })),
    );
    const err = await client.complete(req, sig(), () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).retryable).toBe(true);
    expect((err as ModelError).unreachable).toBe(true);
    expect((err as ModelError).message).toMatch(/cut off/);
  });

  it('accepts a stream that ends with a finish reason even without [DONE]', async () => {
    const { client } = make(() =>
      sse(chunk({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })),
    );
    const res = await client.complete(req, sig(), () => {});
    expect(res.text).toBe('ok');
  });
});

describe('the answer of a finish call', () => {
  const finishChunks = (...argPieces: string[]) =>
    toolDelta(0, { name: 'finish', arguments: argPieces[0] ?? '' }, 'c1') +
    argPieces
      .slice(1)
      .map((a) => toolDelta(0, { arguments: a }))
      .join('') +
    chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
    'data: [DONE]\n\n';

  it('streams the answer as it is written and still returns the whole call', async () => {
    const { client, seen } = make(() =>
      sse(finishChunks('{"answer":"It is ', 'sunny\\n', 'in caf\\u00e9."}')),
    );
    const got: string[] = [];
    const res = await client.complete(req, sig(), undefined, undefined, (d) => got.push(d));
    expect(got.join('')).toBe('It is sunny\nin café.');
    expect(got.length).toBeGreaterThan(1);
    expect(res.calls).toEqual([{ tool: 'finish', args: { answer: 'It is sunny\nin café.' } }]);
    expect(JSON.parse(String(seen[0]?.body)).stream).toBe(true);
  });

  it('never forwards the arguments of another tool', async () => {
    const other =
      toolDelta(0, {
        name: 'write_file',
        arguments: '{"path":"a.txt","answer":"x","content":"sec',
      }) +
      toolDelta(0, { arguments: 'ret"}' }) +
      chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n';
    const { client } = make(() => sse(other));
    const got: string[] = [];
    const text: string[] = [];
    await client.complete(
      req,
      sig(),
      (d) => text.push(d),
      undefined,
      (d) => got.push(d),
    );
    expect(got).toEqual([]);
    expect(text).toEqual([]);
  });

  it('keeps plain text on onText and out of onAnswer', async () => {
    const { client } = make(() =>
      sse(chunk({ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] })),
    );
    const got: string[] = [];
    const text: string[] = [];
    await client.complete(
      req,
      sig(),
      (d) => text.push(d),
      undefined,
      (d) => got.push(d),
    );
    expect(text).toEqual(['Hello']);
    expect(got).toEqual([]);
  });

  it('asks for a stream when only onAnswer is given', async () => {
    const { client, seen } = make(() => sse(finishChunks('{"answer":"ok"}')));
    await client.complete(req, sig(), undefined, undefined, () => {});
    expect(JSON.parse(String(seen[0]?.body)).stream).toBe(true);
  });
});

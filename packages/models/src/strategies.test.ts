import {
  type ModelCaps,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
} from '@remy/core';
import { describe, expect, it } from 'vitest';
import { extractJson, withJsonTools } from './json-tools.ts';
import { withNativeTools } from './native.ts';
import { selectStrategy } from './strategy.ts';
import type { RawRequest } from './types.ts';

const caps = (over: Partial<ModelCaps> = {}): ModelCaps => ({
  nativeTools: true,
  jsonSchema: false,
  contextTokens: 8000,
  pricing: { inPerMTok: 0, outPerMTok: 0 },
  ...over,
});
const usage = { inTokens: 1, outTokens: 2 };

function fake(replies: ModelResponse[], c = caps()) {
  const seen: RawRequest[] = [];
  const client: ModelClient = {
    id: 'fake',
    caps: c,
    async complete(req) {
      seen.push(structuredClone(req));
      const r = replies[seen.length - 1];
      if (!r) throw new Error('exhausted');
      return r;
    },
  };
  return { client, seen };
}
const req: ModelRequest = {
  system: 'You are Remy.',
  messages: [
    { role: 'user', content: 'go' },
    { role: 'assistant', calls: [{ callId: 'c1', tool: 'read', args: { path: 'a' } }] },
    { role: 'tool', callId: 'c1', tool: 'read', content: 'file text' },
  ],
  tools: [
    { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
    { name: 'finish', description: 'Done', parameters: { type: 'object' } },
  ],
  maxOutputTokens: 100,
  temperature: 0,
};
const sig = new AbortController().signal;
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });
const say = (text: string): ModelResponse => ({ text, calls: [], usage });

describe('withNativeTools', () => {
  it('passes valid calls through', async () => {
    const { client, seen } = fake([call('read', { path: 'x' })]);
    const r = await withNativeTools(client).complete(req, sig);
    expect(r.calls).toEqual([{ tool: 'read', args: { path: 'x' } }]);
    expect(seen).toHaveLength(1);
  });

  it('repairs unparseable args and accumulates usage', async () => {
    const { client, seen } = fake([call('read', '{bad'), call('read', { path: 'x' })]);
    const r = await withNativeTools(client).complete(req, sig);
    expect(r.calls[0]?.args).toEqual({ path: 'x' });
    expect(r.usage).toEqual({ inTokens: 2, outTokens: 4 });
    const msgs = seen[1]?.messages ?? [];
    expect(msgs.at(-2)?.role).toBe('assistant');
    expect(msgs.at(-1)).toMatchObject({ role: 'user' });
    expect((msgs.at(-1) as { content: string }).content).toContain('not a valid JSON object');
  });

  it('repairs unknown tool names', async () => {
    const { client, seen } = fake([call('nope', {}), call('finish', {})]);
    await withNativeTools(client).complete(req, sig);
    const last = seen[1]?.messages.at(-1) as { content: string };
    expect(last.content).toContain('Unknown tool "nope"');
  });

  it('gives up after 2 retries with a non-retryable error', async () => {
    const { client, seen } = fake([call('x', {}), call('x', {}), call('x', {}), call('read', {})]);
    const err = await withNativeTools(client)
      .complete(req, sig)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(false);
    expect(seen).toHaveLength(3);
  });

  it('allows text-only replies', async () => {
    const { client } = fake([say('hello')]);
    expect((await withNativeTools(client).complete(req, sig)).text).toBe('hello');
  });
});

describe('extractJson', () => {
  const want = { tool: 'read', args: { path: 'a' } };
  it.each([
    ['plain', '{"tool":"read","args":{"path":"a"}}'],
    ['fenced', 'Sure!\n```json\n{"tool":"read","args":{"path":"a"}}\n```\nDone.'],
    ['prose', 'I will call {"tool":"read","args":{"path":"a"}} now'],
  ])('%s', (_n, text) => {
    expect(extractJson(text)).toEqual(want);
  });

  it('handles braces inside strings', () => {
    expect(extractJson('x {"tool":"read","args":{"path":"}{"}} y')).toEqual({
      tool: 'read',
      args: { path: '}{' },
    });
  });

  it('skips unrelated objects before the call', () => {
    expect(extractJson('{"a":1} then {"tool":"read","args":{}}')).toEqual({
      tool: 'read',
      args: {},
    });
  });
  it('throws when there is no JSON', () => {
    expect(() => extractJson('nothing here')).toThrow();
  });
});

describe('withJsonTools', () => {
  it('sends no native tools, lists tools in the system prompt, and renders history', async () => {
    const { client, seen } = fake([say('{"tool":"finish","args":{}}')]);
    const r = await withJsonTools(client).complete(req, sig);
    expect(r.calls).toEqual([{ tool: 'finish', args: {} }]);
    expect(r.text).toBeUndefined();
    const s = seen[0] as RawRequest;
    expect(s.tools).toEqual([]);
    expect(s.system).toContain('You are Remy.');
    expect(s.system).toContain('- read: Read a file');
    expect(s.system).toContain('"type":"object"');
    expect(s.responseFormat).toEqual({ type: 'json_object' });
    expect(s.messages[1]).toEqual({
      role: 'assistant',
      content: '{"tool":"read","args":{"path":"a"}}',
    });
    expect(s.messages[2]).toEqual({ role: 'user', content: 'Result of read (c1): file text' });
  });

  it('uses json_schema when supported', async () => {
    const { client, seen } = fake([say('{"tool":"finish","args":{}}')], caps({ jsonSchema: true }));
    await withJsonTools(client).complete(req, sig);
    const rf = seen[0]?.responseFormat as { type: string; json_schema: { schema: unknown } };
    expect(rf.type).toBe('json_schema');
    expect(JSON.stringify(rf.json_schema.schema)).toContain('"enum":["read","finish"]');
  });

  it('extracts JSON from fenced prose', async () => {
    const { client } = fake([say('Here:\n```json\n{"tool":"read","args":{"path":"z"}}\n```')]);
    const r = await withJsonTools(client).complete(req, sig);
    expect(r.calls).toEqual([{ tool: 'read', args: { path: 'z' } }]);
  });

  it('repairs with the exact error, then succeeds', async () => {
    const { client, seen } = fake([
      say('I think we should read'),
      say('{"tool":"ghost","args":{}}'),
      say('{"tool":"read","args":{"path":"a"}}'),
    ]);
    const r = await withJsonTools(client).complete(req, sig);
    expect(r.calls[0]?.tool).toBe('read');
    expect(r.usage).toEqual({ inTokens: 3, outTokens: 6 });
    const second = seen[1]?.messages.at(-1) as { content: string };
    expect(second.content).toContain('no JSON object found');
    const third = seen[2]?.messages.at(-1) as { content: string };
    expect(third.content).toContain('unknown tool "ghost"');
    expect(third.content).toContain('read, finish');
  });

  it('rejects non-object args and fails after 2 retries', async () => {
    const { client, seen } = fake([
      say('{"tool":"read","args":"x"}'),
      say('{"tool":"read"}'),
      say('{"args":{}}'),
    ]);
    const err = await withJsonTools(client)
      .complete(req, sig)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('missing string field "tool"');
    expect(seen).toHaveLength(3);
  });
});

describe('selectStrategy', () => {
  it('picks native when supported, JSON otherwise', async () => {
    const a = fake([call('read', {})]);
    await selectStrategy(a.client).complete(req, sig);
    expect(a.seen[0]?.tools).toHaveLength(2);
    const b = fake([say('{"tool":"read","args":{}}')], caps({ nativeTools: false }));
    await selectStrategy(b.client).complete(req, sig);
    expect(b.seen[0]?.tools).toEqual([]);
  });
});

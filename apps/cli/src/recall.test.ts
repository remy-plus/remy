import type { ModelRequest } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import type { MemoryEntry } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { withRecall } from './recall.ts';

const note = (id: string, text: string): MemoryEntry => ({
  id,
  text,
  kind: 'preference',
  source: '',
  created: '2026-10-28T00:00:00.000Z',
});

const req = (...users: string[]): ModelRequest => ({
  system: 'SYSTEM',
  messages: users.flatMap((u, i) => [
    { role: 'user' as const, content: u },
    ...(i < users.length - 1 ? [{ role: 'assistant' as const, content: `answer ${i}` }] : []),
  ]),
  tools: [],
  maxOutputTokens: 100,
  temperature: 0,
});

function setup(notes: MemoryEntry[], enabled = true) {
  const inner = new ScriptedModelClient(
    Array.from({ length: 5 }, () => ({
      text: 'ok',
      calls: [],
      usage: { inTokens: 1, outTokens: 1 },
    })),
  );
  const model = withRecall(inner, { enabled: () => enabled, notes: () => notes, hasTools: true });
  return { inner, model, notes };
}

const signal = new AbortController().signal;

describe('withRecall', () => {
  it('puts the notes in front of the user message, not in the system prompt', async () => {
    const { inner, model } = setup([note('mem_a', 'Prefers metric units')]);
    await model.complete(req('how far is it in metric units?'), signal);
    const sent = inner.requests[0];
    expect(sent?.system).toMatch(/^SYSTEM\n\nCall remember only/);
    expect(sent?.system).not.toContain('mem_a');
    expect(sent?.messages[0]?.content).toMatch(/mem_a.*Prefers metric units[\s\S]*\n\nhow far/);
  });

  it('keeps earlier messages word for word after a new note and a new turn', async () => {
    const { inner, model, notes } = setup([note('mem_a', 'Prefers metric units')]);
    await model.complete(req('metric units please'), signal);
    notes.push(note('mem_b', 'Lives in Toronto'));
    await model.complete(req('metric units please', 'what about Toronto?'), signal);
    const [first, second] = inner.requests;
    expect(second?.system).toBe(first?.system);
    expect(second?.messages[0]).toEqual(first?.messages[0]);
    expect(second?.messages[2]?.content).toContain('mem_b');
  });

  it('leaves the request alone when personalising is off', async () => {
    const { inner, model } = setup([note('mem_a', 'Prefers metric units')], false);
    const r = req('metric units please');
    await model.complete(r, signal);
    expect(inner.requests[0]).toEqual(r);
  });
});

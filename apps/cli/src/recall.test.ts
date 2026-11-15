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

function setup(notes: MemoryEntry[], enabled = true, situation?: () => Promise<string>) {
  const inner = new ScriptedModelClient(
    Array.from({ length: 5 }, () => ({
      text: 'ok',
      calls: [],
      usage: { inTokens: 1, outTokens: 1 },
    })),
  );
  const model = withRecall(inner, {
    enabled: () => enabled,
    notes: () => notes,
    hasTools: true,
    ...(situation && { situation }),
  });
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

describe('withRecall: situation', () => {
  it('sends the situation even with personalising off, frozen per message', async () => {
    let n = 0;
    const { inner, model } = setup([], false, async () => `SITUATION ${++n}`);
    await model.complete(req('first'), signal);
    await model.complete(req('first', 'second'), signal);
    const [a, b] = inner.requests;
    expect(a?.system).toBe('SYSTEM');
    expect(a?.messages[0]?.content).toBe('SITUATION 1\n\nfirst');
    expect(b?.messages[0]).toEqual(a?.messages[0]);
    expect(b?.messages[2]?.content).toBe('SITUATION 2\n\nsecond');
  });

  it('puts the situation before the notes', async () => {
    const { inner, model } = setup([note('mem_a', 'Prefers metric units')], true, async () => 'S');
    await model.complete(req('metric please'), signal);
    expect(inner.requests[0]?.messages[0]?.content).toMatch(/^S\n\nThe user's own saved notes/);
  });

  it('ranks with vectors when given, and not at all when personalising is off', async () => {
    const notes = [note('mem_a', 'Has a dog named Kiwi'), note('mem_b', 'Prefers metric units')];
    let asked = 0;
    const semantic = async () => {
      asked += 1;
      return { vectors: new Map([['mem_a', [1, 0]]]), query: [1, 0] };
    };
    const mk = (enabled: boolean) => {
      const inner = new ScriptedModelClient([
        { text: 'ok', calls: [], usage: { inTokens: 1, outTokens: 1 } },
      ]);
      const model = withRecall(inner, {
        enabled: () => enabled,
        notes: () => notes,
        semantic,
        hasTools: true,
        situation: async () => 'NOW',
      });
      return { inner, model };
    };
    const on = mk(true);
    await on.model.complete(req('tell me about the animal'), signal);
    expect(JSON.stringify(on.inner.requests[0]?.messages)).toContain('Kiwi');
    expect(asked).toBe(1);
    const off = mk(false);
    await off.model.complete(req('tell me about the animal'), signal);
    expect(JSON.stringify(off.inner.requests[0]?.messages)).not.toContain('Kiwi');
    expect(asked).toBe(1);
  });
});

describe('withRecall: corrections', () => {
  const mk = (howto: boolean) => {
    const inner = new ScriptedModelClient(
      Array.from({ length: 4 }, () => ({
        text: 'ok',
        calls: [],
        usage: { inTokens: 1, outTokens: 1 },
      })),
    );
    return {
      inner,
      model: withRecall(inner, {
        enabled: () => true,
        notes: () => [],
        hasTools: true,
        howto: () => howto,
      }),
    };
  };
  const sentText = (inner: ScriptedModelClient, i = 0) =>
    JSON.stringify(inner.requests[i]?.messages);

  it('adds the note to a correction of an earlier answer', async () => {
    const { inner, model } = mk(true);
    await model.complete(req('find the invoice', 'No, use the other folder'), signal);
    expect(sentText(inner)).toContain('is correcting your last answer');
  });

  it('not to a plain follow-up, a new request, or a first message', async () => {
    const { inner, model } = mk(true);
    await model.complete(req('find the invoice', 'and the one from May?'), signal);
    await model.complete(req('find the invoice', 'now email it to Sam'), signal);
    await model.complete(req('No, use the other folder'), signal);
    for (const i of [0, 1, 2]) expect(sentText(inner, i)).not.toContain('correcting');
  });

  it('not when personalising is off', async () => {
    const { inner, model } = mk(false);
    await model.complete(req('find the invoice', 'No, use the other folder'), signal);
    expect(sentText(inner)).not.toContain('correcting');
  });

  it('once per task: a second correction in the same task gets no note', async () => {
    const { inner, model } = mk(true);
    const messages = [
      ...req('find the invoice', 'No, use the other folder').messages,
      { role: 'assistant' as const, content: 'done' },
      { role: 'user' as const, content: 'That is wrong, it was in Drive' },
    ];
    await model.complete(req('find the invoice', 'No, use the other folder'), signal);
    await model.complete({ ...req('x'), messages }, signal);
    const last = inner.requests[1]?.messages.at(-1)?.content as string;
    expect(last).not.toContain('correcting');
  });

  it('builds the situation and ranks by meaning side by side, and reports the time', async () => {
    const inner = new ScriptedModelClient([
      { text: 'ok', calls: [], usage: { inTokens: 1, outTokens: 1 } },
    ]);
    const started: string[] = [];
    const gate = (name: string, ms: number, value: string) => async () => {
      started.push(name);
      await new Promise((r) => setTimeout(r, ms));
      return value;
    };
    const preps: { totalMs: number; situationMs: number; memoryMs: number }[] = [];
    const model = withRecall(inner, {
      enabled: () => true,
      notes: () => [note('mem_a', 'Likes tea')],
      hasTools: false,
      semantic: async () => {
        await gate('semantic', 80, '')();
        return undefined;
      },
      situation: gate('situation', 80, 'SITUATION'),
      onPrep: (t) => preps.push(t),
    });
    const t0 = Date.now();
    await model.complete(req('hello'), signal);
    // Both were started before either finished, so the wait is one delay, not two.
    expect(started).toEqual(['semantic', 'situation']);
    expect(Date.now() - t0).toBeLessThan(150);
    expect(preps).toHaveLength(1);
    expect(preps[0]?.situationMs).toBeGreaterThanOrEqual(70);
    expect(preps[0]?.memoryMs).toBeGreaterThanOrEqual(70);
    expect(preps[0]?.totalMs).toBeLessThan(preps[0] ? preps[0].situationMs + preps[0].memoryMs : 0);
    expect(inner.requests[0]?.messages[0]?.content).toContain('SITUATION');
  });

  it('reports the prep time once per message, not on a repeat of the same message', async () => {
    const preps: number[] = [];
    const inner = new ScriptedModelClient(
      Array.from({ length: 3 }, () => ({
        text: 'ok',
        calls: [],
        usage: { inTokens: 1, outTokens: 1 },
      })),
    );
    const model = withRecall(inner, {
      enabled: () => false,
      notes: () => [],
      hasTools: false,
      situation: async () => 'S',
      onPrep: (t) => preps.push(t.totalMs),
    });
    await model.complete(req('one'), signal);
    await model.complete(req('one'), signal);
    expect(preps).toHaveLength(1);
  });
});

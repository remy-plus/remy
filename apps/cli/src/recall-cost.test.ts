// Cost as memory grows: the notes block is picked once per user message, sits after the cached
// prefix, stays inside its token budget and does not change between the steps of one task.
import type { Message, ModelRequest } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import {
  type MemoryEntry,
  NOTES_BUDGET_TOKENS,
  NOTES_MAX,
  notesBlock,
  noteTokens,
} from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { withRecall } from './recall.ts';

const THINGS = ['lamp', 'kettle', 'bicycle', 'tent', 'guitar', 'camera', 'desk', 'sofa'];
const TOPICS = ['pharmacy', 'dentist', 'flights', 'recipes', 'budget', 'garden'];

/** `n` distinct notes: a tenth are preferences, the rest facts, all saved at the same instant. */
export const world = (n: number): MemoryEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `mem_${i.toString(16).padStart(5, '0')}`,
    text:
      i % 10 === 0
        ? `Prefers ${TOPICS[i % TOPICS.length]} answers short, style ${i}`
        : `Owns a ${THINGS[i % THINGS.length]} bought in ${2000 + (i % 25)}, shelf ${i}`,
    kind: i % 10 === 0 ? ('preference' as const) : ('about_you' as const),
    source: '',
    created: '2026-10-28T00:00:00.000Z',
  }));

const sharedPrefix = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

const serialise = (r: ModelRequest) => JSON.stringify([r.tools, r.system, r.messages]);
const SYSTEM = 'You are Remy. '.repeat(120);
const signal = new AbortController().signal;
const QUESTIONS = [
  'Which pharmacy do I use?',
  'Find flights to Faro in May',
  'Draft a budget for the garden',
  'Where did I put the kettle?',
  'Summarise my dentist visits',
  'Any recipes I liked?',
];

export interface Measure {
  notes: number;
  requests: number;
  promptChars: number[];
  prefixStable: number;
  notesChars: number[];
  situationChars: number;
}

/** A 12-turn chat, two model steps per turn (the second after a tool result). */
export async function chat(notes: MemoryEntry[], turns = 12): Promise<Measure> {
  const sent: string[] = [];
  const inner = new ScriptedModelClient([]);
  const spy = {
    id: 'spy',
    caps: inner.caps,
    async complete(r: ModelRequest) {
      sent.push(serialise(r));
      return { text: 'ok', calls: [], usage: { inTokens: 1, outTokens: 1 } };
    },
  };
  let clock = 0;
  const situation = async () =>
    `Situation when the user sent the next message (from Remy, not the user):\n- Local time: minute ${++clock}.`;
  const model = withRecall(spy, {
    enabled: () => true,
    notes: () => notes,
    hasTools: true,
    situation,
  });
  const messages: Message[] = [];
  const notesChars: number[] = [];
  for (let t = 0; t < turns; t++) {
    const q = `${QUESTIONS[t % QUESTIONS.length]} (${t})`;
    messages.push({ role: 'user', content: q });
    notesChars.push(notesBlock(notes, q).length);
    const req = (): ModelRequest => ({
      system: SYSTEM,
      messages: [...messages],
      tools: [],
      maxOutputTokens: 100,
      temperature: 0,
    });
    await model.complete(req(), signal);
    messages.push({ role: 'assistant', calls: [{ callId: `c${t}`, tool: 'read', args: {} }] });
    messages.push({ role: 'tool', callId: `c${t}`, tool: 'read', content: `result ${t}` });
    await model.complete(req(), signal);
    messages.push({ role: 'assistant', content: `answer ${t}` });
  }
  let shared = 0;
  let total = 0;
  for (let i = 1; i < sent.length; i++) {
    shared += sharedPrefix(sent[i - 1] as string, sent[i] as string);
    total += (sent[i - 1] as string).length;
  }
  return {
    notes: notes.length,
    requests: sent.length,
    promptChars: sent.map((s) => s.length),
    prefixStable: shared / total,
    notesChars,
    situationChars: (await situation()).length,
  };
}

describe('cost as memory grows', () => {
  it.each([0, 50, 500, 5000])('%i notes: stable prefix and a bounded block', async (n) => {
    const m = await chat(world(n));
    expect(m.requests).toBe(24);
    expect(m.prefixStable).toBeGreaterThanOrEqual(0.99);
    const budgetChars = (NOTES_BUDGET_TOKENS + 80) * 4; // the budget plus the header line
    for (const c of m.notesChars) expect(c).toBeLessThanOrEqual(budgetChars);
    if (process.env.REMY_PRINT_COST) {
      const kib = (m.promptChars.at(-1) ?? 0) / 1024;
      process.stderr.write(
        `| ${n} | ${m.requests} | ${(m.prefixStable * 100).toFixed(2)}% | ${Math.max(...m.notesChars)} chars (${Math.ceil(Math.max(...m.notesChars) / 4)} tokens) | ${m.situationChars} chars | ${kib.toFixed(1)} KiB |\n`,
      );
    }
  });

  it('gives a task one notes block from its first step to its last', async () => {
    const all = world(500);
    const live = [...all];
    const seen: string[] = [];
    const spy = {
      id: 'spy',
      caps: new ScriptedModelClient([]).caps,
      async complete(r: ModelRequest) {
        seen.push((r.messages[0] as { content: string }).content);
        return { text: 'ok', calls: [], usage: { inTokens: 1, outTokens: 1 } };
      },
    };
    const model = withRecall(spy, { enabled: () => true, notes: () => live, hasTools: true });
    const req = (): ModelRequest => ({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Which pharmacy do I use?' }],
      tools: [],
      maxOutputTokens: 100,
      temperature: 0,
    });
    await model.complete(req(), signal);
    live.reverse(); // another process reorders the file
    live.push({
      ...all[1],
      id: 'mem_new',
      text: 'Uses Linden pharmacy',
      kind: 'preference',
    } as MemoryEntry);
    await model.complete(req(), signal);
    await model.complete(req(), signal);
    expect(new Set(seen).size).toBe(1);
  });

  it('picks the same block for the same notes in any order', () => {
    const all = world(500);
    const q = 'Which pharmacy do I use?';
    expect(notesBlock([...all].reverse(), q)).toBe(notesBlock(all, q));
  });

  it('keeps the block inside the note and token limits', () => {
    const block = notesBlock(world(5000), 'Which pharmacy do I use?');
    const lines = block.split('\n').slice(1);
    expect(lines.length).toBeLessThanOrEqual(NOTES_MAX);
    const tokens = world(5000)
      .filter((e) => block.includes(`[${e.id}]`))
      .reduce((a, e) => a + noteTokens(e), 0);
    expect(tokens).toBeLessThanOrEqual(NOTES_BUDGET_TOKENS);
  });
});

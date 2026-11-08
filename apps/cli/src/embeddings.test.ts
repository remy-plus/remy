import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecallTool, type MemoryEntry } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runChecks } from './doctor.ts';
import {
  createNoteEmbedder,
  EMBED_BATCH,
  embeddingModel,
  embeddingStatusFile,
  readEmbeddingStatus,
} from './embeddings.ts';
import { openMemory } from './memory.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-emb-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const BASE = 'https://api.example.test/v1';
const endpoint = () => ({ baseUrl: BASE, apiKey: 'k', model: 'embed-1' });

/** Topics a fake model "understands": a word on a topic gives that axis weight. */
const TOPICS = [/pet|dog|cat|kiwi|animal/i, /live|porto|lisbon|home/i, /work|acme|job/i];
const vecOf = (t: string) => TOPICS.map((re) => (re.test(t) ? 1 : 0.01));

function fakeFetch(opts: { status?: number; reject?: boolean } = {}) {
  const calls: { url: string; texts: string[] }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    const texts = (JSON.parse(init.body) as { input: string[] }).input;
    calls.push({ url, texts });
    if (opts.reject) throw new Error('offline');
    if (opts.status) return new Response('no', { status: opts.status });
    return new Response(
      JSON.stringify({ data: texts.map((t, index) => ({ index, embedding: vecOf(t) })) }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const note = (id: string, text: string): MemoryEntry => ({
  id,
  text,
  kind: 'about_you',
  source: '',
  created: '2026-01-01',
});

const setup = (
  o: { on?: boolean; personalising?: boolean; f?: ReturnType<typeof fakeFetch> } = {},
) => {
  const store = openMemory(home);
  const f = o.f ?? fakeFetch();
  const emb = createNoteEmbedder({
    on: o.on ?? true,
    personalising: () => o.personalising ?? true,
    store,
    endpoint,
    fetch: f.impl,
    statusFile: embeddingStatusFile(home),
  });
  return { store, f, emb };
};

describe('embeddings', () => {
  it('sends nothing unless turned on', async () => {
    const { f, emb } = setup({ on: false });
    expect(await emb.source([note('a', 'Has a dog')], 'pet')).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });

  it('sends nothing when personalising is off', async () => {
    const { f, emb } = setup({ personalising: false });
    expect(await emb.source([note('a', 'Has a dog')], 'pet')).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });

  it('computes each note once, then only the new query', async () => {
    const { f, emb, store } = setup();
    const a = store.add({ text: 'Has a dog named Kiwi', kind: 'about_you', source: '' }).entry;
    const b = store.add({ text: 'Works at Acme', kind: 'about_you', source: '' }).entry;
    await emb.source([a, b], 'my pet');
    expect(f.calls.map((c) => c.texts.length)).toEqual([2, 1]);
    await emb.source([a, b], 'my pet');
    await emb.source([a, b], 'where do I work');
    expect(f.calls.map((c) => c.texts.length)).toEqual([2, 1, 1]);
    // A new process reads the stored vectors: only the query is sent.
    const again = createNoteEmbedder({
      on: true,
      personalising: () => true,
      store: openMemory(home),
      endpoint,
      fetch: f.impl,
    });
    await again.source([a, b], 'my pet');
    expect(f.calls.map((c) => c.texts.length)).toEqual([2, 1, 1, 1]);
  });

  it('computes again only for a note that was edited', async () => {
    const { f, emb, store } = setup();
    const a = store.add({ text: 'Has a dog named Kiwi', kind: 'about_you', source: '' }).entry;
    const b = store.add({ text: 'Works at Acme', kind: 'about_you', source: '' }).entry;
    await emb.source([a, b], 'pet');
    store.edit(a.id, 'Has a cat named Miso');
    const fresh = store.list();
    await emb.source(fresh, 'pet');
    expect(f.calls[2]?.texts).toEqual(['Has a cat named Miso']);
  });

  it('sends notes in batches', async () => {
    const { f, emb } = setup();
    const notes = Array.from({ length: EMBED_BATCH * 2 + 5 }, (_, i) => note(`n${i}`, `Note ${i}`));
    await emb.source(notes, 'q');
    expect(f.calls.map((c) => c.texts.length)).toEqual([EMBED_BATCH, EMBED_BATCH, 5, 1]);
  });

  it('sends only note text and the query, to the configured provider only', async () => {
    const { f, emb } = setup();
    await emb.source([note('mem_1', 'Has a dog named Kiwi')], 'my pet');
    expect(f.calls.every((c) => c.url === `${BASE}/embeddings`)).toBe(true);
    expect(f.calls.flatMap((c) => c.texts)).toEqual(['Has a dog named Kiwi', 'my pet']);
  });

  it.each([
    ['not offered', { status: 404 }],
    ['offline', { reject: true }],
  ])('falls back to local ranking when the endpoint is %s', async (_n, o) => {
    const { f, emb } = setup({ f: fakeFetch(o) });
    const n = [note('a', 'Has a dog')];
    expect(await emb.source(n, 'pet')).toBeUndefined();
    expect(await emb.source(n, 'pet')).toBeUndefined();
    expect(f.calls).toHaveLength(1);
    expect(emb.failure()).toBeTruthy();
    expect(readEmbeddingStatus(home, true, true).state).toBe('failed');
  });

  it('recall finds a note with no shared word through vectors, and without them stays local', async () => {
    const { store, emb } = setup();
    store.add({ text: 'Has a dog named Kiwi', kind: 'about_you', source: '' });
    store.add({ text: 'Works at Acme', kind: 'about_you', source: '' });
    const ctx = { taskId: 't' } as never;
    const withVec = createRecallTool(store, async () => [], emb.source);
    const local = createRecallTool(store, async () => []);
    const q = { query: 'my animal' };
    expect((await withVec.execute(q as never, ctx)).content).toContain('Kiwi');
    expect((await local.execute(q as never, ctx)).content).not.toContain('Kiwi');
  });
});

describe('embedding settings', () => {
  it('picks a default model only for OpenAI', () => {
    expect(embeddingModel({}, 'https://api.openai.com/v1')).toBe('text-embedding-3-small');
    expect(embeddingModel({}, 'https://api.groq.com/openai/v1')).toBeUndefined();
    expect(embeddingModel({ REMY_EMBEDDING_MODEL: 'x' }, 'https://api.groq.com/openai/v1')).toBe(
      'x',
    );
  });

  it('shows in doctor', () => {
    const base = {
      node: 'v26.1.0',
      browser: true,
      docker: false,
      daemon: false,
      schedules: 0,
    } as const;
    const row = (embeddings: { state: 'off' | 'on' | 'failed' | 'unavailable'; detail?: string }) =>
      runChecks({ ...base, search: { off: true, order: [] } as never, embeddings }).find(
        (c) => c.name === 'Embeddings',
      );
    expect(row({ state: 'off' })?.status).toBe('ok');
    expect(row({ state: 'failed', detail: 'the endpoint answered 404' })).toMatchObject({
      status: 'warning',
      detail: expect.stringContaining('local ranking'),
    });
  });
});

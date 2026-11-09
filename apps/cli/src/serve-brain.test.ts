import { afterEach, describe, expect, it } from 'vitest';
import { openMemory } from './memory.ts';
import { createBrainMount } from './serve-brain.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';

let kit: Kit | undefined;
afterEach(async () => {
  await kit?.close();
  kit = undefined;
});

const NOW = new Date('2026-11-08T12:00:00');

async function start(semantic?: Parameters<typeof createBrainMount>[0]['semantic']) {
  let memory: ReturnType<typeof openMemory> | undefined;
  kit = await startKit((home) => {
    memory = openMemory(home, { now: () => NOW });
    return [createBrainMount({ memory, ...(semantic && { semantic }), now: () => NOW })];
  });
  const m = memory as ReturnType<typeof openMemory>;
  const add = (text: string, kind: 'preference' | 'about_you' | 'how_to', source = '') => {
    const r = m.add({ text, kind, source });
    return r.entry.id;
  };
  return { kit, m, add };
}

describe('brain routes', () => {
  it('need the bearer token', async () => {
    const { kit } = await start();
    for (const [method, path] of [
      ['GET', '/api/brain'],
      ['GET', '/api/brain/mem_1'],
      ['PUT', '/api/brain/mem_1'],
      ['DELETE', '/api/brain/mem_1'],
    ] as const)
      expect((await kit.api(path, { method, token: null })).status).toBe(401);
  });

  it('lists notes with counts by kind from the real store, and nothing invented', async () => {
    const { kit, add } = await start();
    const empty = await kit.api('/api/brain');
    expect(empty.json).toEqual({
      total: 0,
      newToday: 0,
      counts: { person: 0, project: 0, 'how-to': 0, fact: 0 },
      notes: [],
      selected: '',
    });
    const a = add('Lives in Porto', 'about_you');
    add('Prefers short replies', 'preference');
    add('Send audit questions to Dana first', 'how_to', 'task_abc');
    const r = await kit.api('/api/brain');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      total: 3,
      newToday: 3,
      counts: { person: 1, project: 0, 'how-to': 1, fact: 1 },
    });
    expect(r.json.notes).toHaveLength(3);
    const porto = r.json.notes.find((n: { id: string }) => n.id === a);
    expect(porto).toMatchObject({
      title: 'Lives in Porto',
      kind: 'person',
      body: 'Lives in Porto',
      links: [],
      linkCount: 0,
      origin: 'You wrote it · 8 November',
    });
    expect(porto.x).toBeGreaterThanOrEqual(6);
    expect(porto.y).toBeLessThanOrEqual(94);
    expect(r.json.notes.find((n: { kind: string }) => n.kind === 'how-to').origin).toContain(
      'Remy saved it',
    );
    expect(r.json.selected).toBe(r.json.notes[0].id);
  });

  it('filters by kind and refuses an unknown one', async () => {
    const { kit, add } = await start();
    add('Lives in Porto', 'about_you');
    add('Prefers short replies', 'preference');
    const r = await kit.api('/api/brain?kind=fact');
    expect(r.json.notes.map((n: { body: string }) => n.body)).toEqual(['Prefers short replies']);
    expect(r.json.total).toBe(2); // counts do not shrink with the filter
    expect((await kit.api('/api/brain?kind=secret')).status).toBe(400);
  });

  it('searches with the same ranking as recall, so a related word finds the note', async () => {
    const { kit, add } = await start();
    add('Lives in Porto', 'about_you');
    add('Has a dog named Kiwi', 'about_you');
    add('Prefers short replies', 'preference');
    const where = await kit.api(`/api/brain?q=${encodeURIComponent('Where do I live?')}`);
    expect(where.json.notes.map((n: { body: string }) => n.body)).toEqual(['Lives in Porto']);
    const pet = await kit.api('/api/brain?q=my%20pet');
    expect(pet.json.notes.map((n: { body: string }) => n.body)).toEqual(['Has a dog named Kiwi']);
    const none = await kit.api('/api/brain?q=zebra');
    expect(none.json.notes).toEqual([]);
    expect(none.json.total).toBe(3);
    expect((await kit.api(`/api/brain?q=${'x'.repeat(201)}`)).status).toBe(400);
  });

  it('uses vectors when embeddings are on, and words when they fail', async () => {
    const calls: string[] = [];
    const { kit, add } = await start(async (notes, query) => {
      calls.push(query);
      if (query === 'boom') throw new Error('endpoint down');
      return {
        query: [1, 0],
        vectors: new Map(notes.map((n) => [n.id, n.text.includes('Porto') ? [1, 0] : [0, 1]])),
      };
    });
    add('Lives in Porto', 'about_you');
    add('Prefers short replies', 'preference');
    const r = await kit.api('/api/brain?q=city');
    expect(r.json.notes.map((n: { body: string }) => n.body)).toEqual(['Lives in Porto']);
    const fallback = await kit.api('/api/brain?q=boom');
    expect(fallback.status).toBe(200);
    expect(calls).toEqual(['city', 'boom']);
  });

  it('draws links only from notes that may contradict each other', async () => {
    const { kit, add } = await start();
    const a = add('Lives in Porto', 'about_you');
    const b = add('Lives in Lisbon', 'about_you');
    const c = add('Prefers short replies', 'preference');
    const r = await kit.api('/api/brain');
    const by = Object.fromEntries(r.json.notes.map((n: { id: string }) => [n.id, n]));
    expect(by[a].links).toEqual([b]);
    expect(by[b].links).toEqual([a]);
    expect(by[a].linkCount).toBe(1);
    expect(by[c].links).toEqual([]);
    expect((await kit.api(`/api/brain/${a}`)).json.note.links.every((id: string) => id !== a)).toBe(
      true,
    );
  });

  it('reads one note, edits it, and refuses a bad edit', async () => {
    const { kit, m, add } = await start();
    const id = add('Lives in Porto', 'about_you');
    expect((await kit.api(`/api/brain/${id}`)).json.note.body).toBe('Lives in Porto');
    const put = await kit.api(`/api/brain/${id}`, {
      method: 'PUT',
      body: { text: 'Lives in Lisbon' },
    });
    expect(put.status).toBe(200);
    expect(m.list().map((e) => e.text)).toEqual(['Lives in Lisbon']);
    for (const body of [{ text: '' }, { text: 'x'.repeat(201) }, { text: 'a', kind: 'fact' }, {}])
      expect((await kit.api(`/api/brain/${id}`, { method: 'PUT', body })).status).toBe(400);
    expect(
      (await kit.api('/api/brain/mem_nope', { method: 'PUT', body: { text: 'a' } })).status,
    ).toBe(404);
    expect((await kit.api('/api/brain/mem_nope')).status).toBe(404);
    expect(m.list()).toHaveLength(1);
  });

  it('deletes only the named note', async () => {
    const { kit, m, add } = await start();
    const a = add('Lives in Porto', 'about_you');
    const b = add('Prefers short replies', 'preference');
    expect((await kit.api(`/api/brain/${a}`, { method: 'DELETE' })).status).toBe(200);
    expect(m.list().map((e) => e.id)).toEqual([b]);
    expect((await kit.api(`/api/brain/${a}`, { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api('/api/brain/a%20b', { method: 'DELETE' })).status).toBe(404);
    expect((await kit.api('/api/brain', { method: 'DELETE' })).status).toBe(405);
    expect(m.list()).toHaveLength(1);
  });
});

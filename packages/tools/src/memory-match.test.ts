import { describe, expect, it } from 'vitest';
import { contradicts, planAdd, sameFact } from './memory-match.ts';
import type { MemoryEntry, MemoryKind } from './memory-tools.ts';

const n = (text: string, kind: MemoryKind = 'about_you') => ({ text, kind });
const entry = (id: string, text: string, kind: MemoryKind = 'about_you'): MemoryEntry => ({
  id,
  text,
  kind,
  source: '',
  created: '2026-01-01',
});

describe('sameFact', () => {
  it('matches the same note in other words', () => {
    const pairs: [string, string][] = [
      ['Likes tea', 'likes  tea.'],
      ['Likes tea', 'The user likes tea'],
      ['Likes tea with milk', 'Always likes tea'],
      ['Lives in Lisbon', 'Lives in Lisbon, Portugal'],
      ['Works at Acme', 'Works for Acme'],
      ['Prefers short answers', 'Prefers short answer'],
      ['Drinks coffee black every morning', 'Drinks black coffee every morning'],
    ];
    for (const [a, b] of pairs) expect(sameFact(n(a), n(b)), `${a} / ${b}`).toBe(true);
  });

  it('keeps different facts apart', () => {
    const pairs: [string, string][] = [
      ['Likes tea', 'Likes coffee'],
      ['Lives in Lisbon', 'Lives in Porto'],
      ['Likes dark roast coffee', 'Likes light roast coffee'],
      ['Sister is named Ines', 'Brother is named Ines'],
      ['Likes tea', 'Does not like tea'],
      ['Works at Acme on payments', 'Works at Acme on search'],
    ];
    for (const [a, b] of pairs.slice(0, -1))
      expect(sameFact(n(a), n(b)), `${a} / ${b}`).toBe(false);
  });

  it('never merges notes of different kinds', () => {
    expect(sameFact(n('Likes tea', 'preference'), n('Likes tea', 'about_you'))).toBe(false);
  });
});

describe('contradicts', () => {
  it('flags one value of a single-valued fact against another', () => {
    const pairs: [string, string][] = [
      ['Lives in Lisbon', 'Lives in Porto'],
      ['User lives in Lisbon.', 'Lives in Porto'],
      ['Works at Acme', 'Works for Globex'],
      ['Is based in Berlin', 'Lives in Munich'],
      ['Name is Dana', 'My name is Dan'],
      ['Favourite colour is blue', 'Favorite colour is green'],
    ];
    for (const [a, b] of pairs) expect(contradicts(n(a), n(b)), `${a} / ${b}`).toBe(true);
  });

  it('flags a note against its negation', () => {
    expect(contradicts(n('Likes cilantro'), n('Does not like cilantro'))).toBe(true);
    expect(contradicts(n("Doesn't eat meat"), n('Eats meat'))).toBe(true);
  });

  it('does not flag notes that can both be true', () => {
    const pairs: [string, string][] = [
      ['Lives in Lisbon', 'Lives in Lisbon, Portugal'],
      ['Lives in Lisbon', 'Works at Acme'],
      ['Lives in Lisbon', 'Likes Porto'],
      ['Works at Acme', 'Works at Acme part time'],
      ['Favourite colour is blue', 'Favourite food is pizza'],
      ['Likes tea', 'Likes coffee'],
      ['Likes tea', 'Does not like coffee'],
      ['Sister lives in Porto', 'Lives in Lisbon'],
      ['Name is Dana', 'Dog name is Rex'],
    ];
    for (const [a, b] of pairs) expect(contradicts(n(a), n(b)), `${a} / ${b}`).toBe(false);
  });

  it('only compares notes of the same kind', () => {
    expect(contradicts(n('Lives in Lisbon', 'about_you'), n('Lives in Porto', 'preference'))).toBe(
      false,
    );
  });
});

describe('planAdd', () => {
  const have = [entry('a', 'Lives in Lisbon'), entry('b', 'Likes tea with milk', 'preference')];

  it('adds a new note', () => {
    expect(planAdd(have, n('Has a dog named Rex'))).toEqual({ action: 'add', conflicts: [] });
  });

  it('reports the exact same text as existing', () => {
    expect(planAdd(have, n('lives in lisbon.'))).toMatchObject({ action: 'exists' });
  });

  it('merges a restatement and keeps the longer wording', () => {
    const longer = planAdd(have, n('Likes tea with milk and honey', 'preference'));
    expect(longer).toMatchObject({ action: 'merge', text: 'Likes tea with milk and honey' });
    const shorter = planAdd(have, n('Likes milk tea', 'preference'));
    expect(shorter).toMatchObject({ action: 'merge', text: 'Likes tea with milk' });
  });

  it('adds a contradicting note and names what it contradicts', () => {
    const p = planAdd(have, n('Lives in Porto'));
    expect(p.action).toBe('add');
    expect(p.conflicts.map((c) => c.id)).toEqual(['a']);
  });
});

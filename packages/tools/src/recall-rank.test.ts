import { bm25 } from '@remy/core';
import { describe, expect, it } from 'vitest';
import {
  COSINE_PICK,
  cosine,
  lexicalScores,
  rankScores,
  type Semantic,
  stem,
  tokens,
} from './recall-rank.ts';

/** 40 notes of the kind people keep, one fact each. */
const NOTES: string[] = [
  'Lives in Porto',
  'Works at Acme Logistics as an accountant',
  'Has a dog named Kiwi',
  'Is allergic to peanuts',
  'Prefers short answers',
  'Wants distances and weights in metric units',
  'Sister Marta lives in Lisbon',
  'Dentist is Dr. Okafor on Hill Street',
  'Passport expires in March 2029',
  'Drives a green Skoda Octavia',
  'Birthday is on 14 June',
  'Is vegetarian but eats fish',
  'Speaks Portuguese and English',
  'Always orders oolong tea',
  'Flight seat preference is the aisle',
  'Wakes up at 6:30 on weekdays',
  'Partner is called Daniel',
  'Daughter Inês starts school in September',
  'Bank is Millennium BCP',
  'Phone number is 912 345 678',
  'Wi-Fi at home is called FoxNet',
  'Runs 5 km every Saturday morning',
  'Uses a Linux laptop for work',
  'Rent is 950 euros due on the 1st',
  'Prefers email over phone calls',
  'Favourite film is Spirited Away',
  'Gym membership renews in January',
  'Keeps a vegetable garden on the balcony',
  'Mother is visiting on 20 December',
  'Does not like cilantro',
  'Timezone is Lisbon time',
  'Newsletter is sent on Fridays',
  'Car insurance is with Fidelidade',
  'Doctor appointment every six months',
  'Wants meeting notes as bullet points',
  'Learning to play the cello',
  'Son Tomás plays football on Tuesdays',
  'Employer pays on the 25th of each month',
  'Prefers window seats on trains',
  'Prints documents at the library',
];

/** Query wording differs from the note's. `want` is the index of the right note. */
const QUERIES: [query: string, want: number][] = [
  ['Where do I live?', 0],
  ['who is my employer', 1],
  ['what is my pet called', 2],
  ['do I have any food allergies', 3],
  ['how long should answers be', 4],
  ['which units should I use for distance', 5],
  ['where does my sister reside', 6],
  ['when does my passport run out', 8],
  ['what car do I drive', 9],
  ['when was I born', 10],
  ['what do I eat', 11],
  ['which languages do I speak', 12],
  ['what is my wife or partner named', 16],
  ['when does my child start school', 17],
  ['what is my mobile number', 19],
  ['how much is my rent', 23],
  ['what is my favourite movie', 25],
  ['what is my husband or partner called', 16],
  ['how should I get notes after a meeting', 34],
  ['which instrument am I learning', 35],
];

const docs = NOTES.map((text, i) => ({ id: `n${i}`, text }));
const topThree = (scores: Map<string, number>) =>
  [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

const hits = (rank: (q: string) => Map<string, number>) =>
  QUERIES.filter(([q, want]) => topThree(rank(q)).includes(`n${want}`)).length;

describe('local ranking', () => {
  it('finds the right note in the top three for at least 17 of 20 reworded queries', () => {
    expect(NOTES).toHaveLength(40);
    expect(QUERIES).toHaveLength(20);
    const after = hits((q) => rankScores(docs, q));
    const before = hits((q) => {
      const s = bm25(
        docs.map((d) => ({ name: d.id, text: d.text })),
        q,
      );
      return new Map([...s].filter(([, v]) => v > 0));
    });
    expect(after).toBeGreaterThanOrEqual(17);
    expect(after).toBeGreaterThan(before);
  });

  it('answers the two examples from the plan', () => {
    const pets = rankScores(docs, 'my pet');
    expect(topThree(pets)[0]).toBe('n2');
    expect(topThree(rankScores(docs, 'Where do I live?'))[0]).toBe('n0');
  });

  it('does not pretend to know a word it has no link for', () => {
    expect(rankScores(docs, 'which musical instrument').has('n35')).toBe(false);
  });
});

describe('normalisation', () => {
  it('folds common endings together', () => {
    expect(stem('lives')).toBe(stem('living'));
    expect(stem('lived')).toBe(stem('live'));
    expect(stem('dogs')).toBe(stem('dog'));
    expect(stem('running')).toBe(stem('run'));
    expect(stem('based')).toBe(stem('base'));
  });

  it('keeps numbers and dates', () => {
    expect(tokens('Passport expires 3rd March 2029')).toEqual(
      expect.arrayContaining(['3', 'march', '2029']),
    );
    expect(tokens('mar')).toContain(stem('march'));
    expect(tokens('5 km at 6:30')).toEqual(expect.arrayContaining(['5', '6', '30']));
  });

  it('finds a note by its number', () => {
    expect(topThree(rankScores(docs, '2029'))[0]).toBe('n8');
  });

  it('keeps a negation note apart from nothing: both words match', () => {
    expect(topThree(rankScores(docs, 'cilantro'))[0]).toBe('n29');
  });

  it('gives no score without a shared word', () => {
    expect(
      lexicalScores(docs, 'zebra').size === 0 ||
        [...lexicalScores(docs, 'zebra').values()].every((v) => v === 0),
    ).toBe(true);
  });
});

describe('with vectors', () => {
  const vec = (...n: number[]) => n;
  const sem: Semantic = {
    vectors: new Map([
      ['n0', vec(1, 0, 0)],
      ['n1', vec(0, 1, 0)],
      ['n35', vec(0, 0, 1)],
    ]),
    query: vec(0, 0.2, 1),
  };

  it('computes cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([], [1])).toBe(0);
  });

  it('returns a note with a close vector and no shared word', () => {
    const s = rankScores(docs, 'which instrument am I learning', sem);
    expect(s.get('n35')).toBeGreaterThan(0);
    expect(cosine(sem.query, [0, 0, 1])).toBeGreaterThan(COSINE_PICK);
    expect(s.has('n0')).toBe(false);
  });

  it('mixes the two signals: a word match with a close vector beats either alone', () => {
    const both = rankScores(docs, 'learning cello', {
      vectors: new Map([
        ['n35', [0, 0, 1]],
        ['n0', [0, 0, 0.9]],
      ]),
      query: [0, 0, 1],
    });
    expect(both.get('n35') as number).toBeGreaterThan(both.get('n0') as number);
  });
});

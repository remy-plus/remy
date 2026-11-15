import { describe, expect, it } from 'vitest';
import { createAnswerStream, createFieldExtractor } from './answer-stream.ts';

/** Feeds `json` in pieces of `size` characters and returns everything extracted. */
function run(json: string, size: number, field = 'answer'): string {
  const x = createFieldExtractor(field);
  let out = '';
  for (let i = 0; i < json.length; i += size) out += x.push(json.slice(i, i + size));
  return out;
}

const SIZES = [1, 2, 3, 5, 7, 1000];

describe('createFieldExtractor', () => {
  it('returns the answer string, however the text is cut', () => {
    const json = JSON.stringify({ answer: 'The price is $5. Done.' });
    for (const n of SIZES) expect(run(json, n)).toBe('The price is $5. Done.');
  });

  it('decodes escapes, including ones split across pieces', () => {
    const answer = 'line one\nline "two"\ttabbed \\ back / slash \b\f\r end';
    const json = JSON.stringify({ answer });
    for (const n of SIZES) expect(run(json, n)).toBe(answer);
  });

  it('decodes \\u escapes and surrogate pairs, whichever way they are cut', () => {
    const json = '{"answer":"caf\\u00e9 \\ud83d\\ude00 ok"}';
    for (const n of SIZES) expect(run(json, n)).toBe('café 😀 ok');
  });

  it('never returns half of a surrogate pair at the end of a piece', () => {
    const x = createFieldExtractor();
    const a = x.push('{"answer":"hi \\ud83d');
    expect(a).toBe('hi ');
    expect(x.push('\\ude00!"}')).toBe('😀!');
  });

  it('keeps a lone high surrogate when no partner comes', () => {
    const x = createFieldExtractor();
    expect(x.push('{"answer":"a\\ud83d"}')).toBe('a\ud83d');
  });

  it('handles raw (unescaped) non-ASCII text', () => {
    const answer = 'Naïve café — 日本語 😀';
    const json = JSON.stringify({ answer });
    for (const n of SIZES) expect(run(json, n)).toBe(answer);
  });

  it('ignores other fields, in any order', () => {
    const json = JSON.stringify({ note: 'not this', answer: 'this one', after: 'nor this' });
    for (const n of SIZES) expect(run(json, n)).toBe('this one');
  });

  it('ignores a string that only looks like the key', () => {
    const json = JSON.stringify({ note: '"answer":"fake"', answer: 'real' });
    for (const n of SIZES) expect(run(json, n)).toBe('real');
  });

  it('ignores a nested field of the same name', () => {
    const json = JSON.stringify({
      meta: { answer: 'nested' },
      list: [{ answer: 'x' }],
      answer: 'top',
    });
    for (const n of SIZES) expect(run(json, n)).toBe('top');
  });

  it('ignores an answer that is not a string', () => {
    for (const v of ['null', '42', '{"a":"b"}', '["x"]', 'true'])
      expect(run(`{"answer":${v}}`, 3)).toBe('');
  });

  it('copes with whitespace around the colon', () => {
    expect(run('{ "answer" \n :\n  "spaced" }', 2)).toBe('spaced');
  });

  it('gives what is known so far for an unfinished answer', () => {
    const x = createFieldExtractor();
    expect(x.push('{"answer":"half an ans')).toBe('half an ans');
    expect(x.push('wer, then')).toBe('wer, then');
  });

  it('returns nothing more after the string ends', () => {
    const x = createFieldExtractor();
    expect(x.push('{"answer":"one","other":"two"}')).toBe('one');
    expect(x.push('{"answer":"three"}')).toBe('');
  });

  it('returns nothing for arguments without the field, or for garbage', () => {
    expect(run('{}', 1)).toBe('');
    expect(run('', 1)).toBe('');
    expect(run('not json at all "answer":"x"', 3)).toBe('');
    expect(run('{"path":"a.txt","content":"hello"}', 4)).toBe('');
  });

  it('reads a long answer with many pieces without losing a character', () => {
    const answer = Array.from({ length: 400 }, (_, i) => `word${i} \\n "q" é`).join(' ');
    const json = JSON.stringify({ answer });
    expect(run(json, 13)).toBe(answer);
  });
});

describe('createAnswerStream', () => {
  const collect = () => {
    const got: string[] = [];
    return { got, stream: createAnswerStream((d) => got.push(d)) };
  };

  it('passes on the answer of a finish call as it grows', () => {
    const { got, stream } = collect();
    stream.push(0, 'finish', '{"ans');
    stream.push(0, undefined, 'wer":"Hel');
    stream.push(0, undefined, 'lo wor');
    stream.push(0, undefined, 'ld"}');
    expect(got).toEqual(['Hel', 'lo wor', 'ld']);
  });

  it('never passes on any other tool', () => {
    const { got, stream } = collect();
    stream.push(0, 'write_file', '{"path":"a","answer":"secret","content":"x"}');
    stream.push(1, 'ask_user', '{"answer":"nope"}');
    expect(got).toEqual([]);
  });

  it('follows several calls in one reply by index', () => {
    const { got, stream } = collect();
    stream.push(0, 'read_file', '{"path":"a"}');
    stream.push(1, 'finish', '{"answer":"done"}');
    expect(got).toEqual(['done']);
  });

  it('keeps text that arrives before the name', () => {
    const { got, stream } = collect();
    stream.push(0, undefined, '{"answer":"early');
    stream.push(0, 'finish', undefined);
    stream.push(0, undefined, ' bird"}');
    expect(got.join('')).toBe('early bird');
  });

  it('drops leading blank space, as the finish tool trims it', () => {
    const { got, stream } = collect();
    stream.push(0, 'finish', '{"answer":"  \\n');
    stream.push(0, undefined, ' Hi"}');
    expect(got.join('')).toBe('Hi');
  });

  it('accepts a name delivered in pieces', () => {
    const { got, stream } = collect();
    stream.push(0, 'fin', undefined);
    stream.push(0, 'ish', '{"answer":"ok"}');
    expect(got).toEqual(['ok']);
  });
});

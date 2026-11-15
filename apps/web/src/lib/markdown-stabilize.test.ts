import { describe, expect, it } from 'vitest';
import { parseAnswer, stabilize } from './markdown.ts';

describe('stabilize', () => {
  it('leaves finished text alone', () => {
    for (const t of [
      'Plain words.',
      'A **bold** word and `code` and *italic*.',
      'See [docs](https://example.com) now.',
      '- one\n- two',
      '* one\n* two',
      '',
    ])
      expect(stabilize(t)).toBe(t);
  });

  it('holds back a bold marker until it closes', () => {
    expect(stabilize('It is **very')).toBe('It is very');
    expect(stabilize('It is **very** nic')).toBe('It is **very** nic');
    expect(stabilize('It is **')).toBe('It is ');
  });

  it('holds back italics and code the same way', () => {
    expect(stabilize('a *slant')).toBe('a slant');
    expect(stabilize('run `npm ins')).toBe('run npm ins');
    expect(stabilize('run `npm` then `x')).toBe('run `npm` then x');
  });

  it('shows the label of a link that is still being written', () => {
    expect(stabilize('Read [the docs](https://exa')).toBe('Read the docs');
    expect(stabilize('Read [the do')).toBe('Read the do');
    expect(stabilize('Read [the docs](')).toBe('Read the docs');
    expect(stabilize('Read [the docs](https://a.com) and [more')).toBe(
      'Read [the docs](https://a.com) and more',
    );
  });

  it('does not take a bullet for italics', () => {
    expect(stabilize('* first item')).toBe('* first item');
    expect(stabilize('- a\n* item *emph')).toBe('- a\n* item emph');
  });

  it('only touches the last line', () => {
    expect(stabilize('first **line\nsecond')).toBe('first **line\nsecond');
  });

  it('leaves an open code block exactly as written', () => {
    const t = 'Here:\n```ts\nconst a = **b;\n[x](';
    expect(stabilize(t)).toBe(t);
  });

  it('gives the same blocks as the finished text once a marker closes', () => {
    const full = 'Total: **$248** for [two](https://a.com).';
    for (let i = 1; i <= full.length; i++) {
      const blocks = parseAnswer(stabilize(full.slice(0, i)));
      const flat = JSON.stringify(blocks);
      expect(flat).not.toContain('**');
      expect(flat).not.toContain('](');
    }
    expect(stabilize(full)).toBe(full);
  });
});

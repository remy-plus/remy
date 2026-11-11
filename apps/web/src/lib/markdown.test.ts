import { describe, expect, it } from 'vitest';
import { inline, parseAnswer, safeHref } from './markdown.ts';

describe('inline', () => {
  it('keeps plain words as one span', () => {
    expect(inline('All done.')).toEqual([{ kind: 'text', text: 'All done.' }]);
  });

  it('reads code before anything else, so markers inside it stay literal', () => {
    expect(inline('run `npm i **x**` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'npm i **x**' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('turns a markdown link into a link', () => {
    expect(inline('see [the docs](https://example.com/a)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the docs', href: 'https://example.com/a' },
    ]);
  });

  it('turns a bare URL into a link and leaves the sentence punctuation out of it', () => {
    expect(inline('Read https://example.com/a.')).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps a closing bracket that belongs to the URL', () => {
    expect(inline('https://en.wikipedia.org/wiki/Remy_(agent)')).toEqual([
      {
        kind: 'link',
        text: 'https://en.wikipedia.org/wiki/Remy_(agent)',
        href: 'https://en.wikipedia.org/wiki/Remy_(agent)',
      },
    ]);
  });

  it('reads bold and italics', () => {
    expect(inline('**done** and *nearly*')).toEqual([
      { kind: 'strong', text: 'done' },
      { kind: 'text', text: ' and ' },
      { kind: 'em', text: 'nearly' },
    ]);
  });

  it('leaves snake_case alone', () => {
    expect(inline('set max_output_chars')).toEqual([
      { kind: 'text', text: 'set max_output_chars' },
    ]);
  });
});

describe('safeHref', () => {
  it.each(['https://example.com', 'http://example.com', 'mailto:a@b.co'])('allows %s', (href) => {
    expect(safeHref(href)).toBe(href);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x'])(
    'refuses %s',
    (href) => {
      expect(safeHref(href)).toBeUndefined();
    },
  );

  it('renders a refused link as its text, never as a link', () => {
    expect(inline('[click](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'click' }]);
  });
});

describe('parseAnswer', () => {
  it('splits paragraphs at blank lines and joins soft wraps', () => {
    expect(parseAnswer('one\ntwo\n\nthree')).toEqual([
      { kind: 'p', spans: [{ kind: 'text', text: 'one two' }] },
      { kind: 'p', spans: [{ kind: 'text', text: 'three' }] },
    ]);
  });

  it('reads a bullet list', () => {
    expect(parseAnswer('- a\n- b')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      },
    ]);
  });

  it('reads a numbered list', () => {
    expect(parseAnswer('1. a\n2. b')).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      },
    ]);
  });

  it('reads a fenced code block as one block, markers and all', () => {
    expect(parseAnswer('```ts\nconst a = **b**;\n```')).toEqual([
      { kind: 'code', text: 'const a = **b**;' },
    ]);
  });

  it('closes an unclosed fence at the end of the answer', () => {
    expect(parseAnswer('```\nstill going')).toEqual([{ kind: 'code', text: 'still going' }]);
  });

  it('reads a heading and a quote', () => {
    expect(parseAnswer('## Result\n> quoted')).toEqual([
      { kind: 'heading', spans: [{ kind: 'text', text: 'Result' }] },
      { kind: 'quote', spans: [{ kind: 'text', text: 'quoted' }] },
    ]);
  });

  it('ends a paragraph where a list starts', () => {
    expect(parseAnswer('Here:\n- a')).toEqual([
      { kind: 'p', spans: [{ kind: 'text', text: 'Here:' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'a' }]] },
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(parseAnswer('   \n\n ')).toEqual([]);
  });
});

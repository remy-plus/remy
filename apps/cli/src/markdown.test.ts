import { describe, expect, it } from 'vitest';
import { inline, lineWidth, type MdLine, renderMarkdown, strWidth } from './markdown.ts';

const plain = (lines: MdLine[]) => lines.map((l) => l.map((s) => s.text).join(''));

describe('inline', () => {
  it('styles bold and code and leaves unclosed markers alone', () => {
    expect(inline('a **b** `c`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', code: true },
    ]);
    expect(inline('half **open')).toEqual([{ text: 'half **open' }]);
    expect(inline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
  });
});

describe('renderMarkdown', () => {
  it('wraps lists with a hanging indent', () => {
    const out = plain(renderMarkdown('- one two three four five six seven eight', 20));
    expect(out[0]).toBe('• one two three four');
    expect(out[1]).toBe('  five six seven');
    expect(plain(renderMarkdown('1. alpha beta gamma delta epsilon', 16))).toEqual([
      '1. alpha beta',
      '   gamma delta',
      '   epsilon',
    ]);
  });

  it('never makes a line wider than the width', () => {
    const text =
      '# Title\n\nA long paragraph with `inline code` and **bold words** that must wrap nicely.\n- item with averyveryveryverylongwordthatcannotfit here\n```\nconst x = 1; // a long code line that should be split rather than overflow\n```';
    for (const w of [14, 20, 40])
      for (const l of renderMarkdown(text, w))
        expect(lineWidth(l)).toBeLessThanOrEqual(Math.max(w, 12));
  });

  it('sets fenced code apart: language label, faint gutter, no fence, a blank row around it', () => {
    const out = renderMarkdown('before\n```ts\nlet a = 1;\n```\nafter', 40);
    expect(plain(out)).toEqual(['before', '', '  ts', '  │ let a = 1;', '', 'after']);
    expect(out[2]?.[0]?.dim).toBe(true);
    expect(out[3]?.[0]?.faint).toBe(true);
  });

  it('lays a pipe table out in aligned columns under a bold header and a rule', () => {
    const out = renderMarkdown(
      '| Type | Action |\n|---|---|\n| pdf | Move to Documents |\n| jpg | Move |',
      60,
    );
    expect(plain(out)).toEqual(
      ['Type   Action', `${'─'.repeat(4 + 3 + 17)}`, 'pdf    Move to Documents', 'jpg    Move'].map(
        (l) => l.trimEnd(),
      ),
    );
    expect(out[0]?.[0]?.bold).toBe(true);
    expect(out[1]?.[0]?.faint).toBe(true);
  });

  it('reads a table written without the outer pipes', () => {
    const out = renderMarkdown('Type | Note\n--- | ---\nTea | Hot', 40);
    expect(plain(out).map((l) => l.trimEnd())).toEqual([
      'Type   Note',
      '───────────',
      'Tea    Hot',
    ]);
  });

  it('clips table cells to fit a narrow width', () => {
    const out = renderMarkdown('| a | b |\n|--|--|\n| short | a very long cell indeed |', 20);
    for (const l of plain(out)) expect(strWidth(l)).toBeLessThanOrEqual(20);
  });

  it('draws a quote bar and a rule under a top heading, dims level three', () => {
    const q = renderMarkdown('> quoted', 40);
    expect(plain(q)).toEqual(['▎ quoted']);
    const h = renderMarkdown('# Title\n### Small', 40);
    expect(plain(h)).toEqual(['Title', '─────', '', 'Small']);
    expect(h[3]?.[0]?.dim).toBe(true);
  });

  it('marks nested list items with a hollow bullet', () => {
    expect(plain(renderMarkdown('- a\n  - b', 40))).toEqual(['• a', '  ◦ b']);
  });

  it('makes headings bold and collapses blank runs', () => {
    const out = renderMarkdown('a\n\n\n## Head\ntext', 40);
    expect(plain(out)).toEqual(['a', '', 'Head', 'text']);
    expect(out[2]?.[0]?.bold).toBe(true);
  });

  it('counts wide characters as two columns', () => {
    expect(strWidth('日本')).toBe(4);
    expect(strWidth('abc')).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { layoutPrompt } from './prompt-layout.ts';

const texts = (l: ReturnType<typeof layoutPrompt>) => l.rows.map((r) => r.text);

describe('layoutPrompt', () => {
  it('is one empty row for no text', () => {
    const l = layoutPrompt('', 0, 20, 6);
    expect(texts(l)).toEqual(['']);
    expect(l).toMatchObject({ total: 1, cursorRow: 0, cursorCol: 0 });
  });

  it('wraps at spaces and keeps every character', () => {
    const l = layoutPrompt('one two three four', 18, 9, 6);
    expect(texts(l)).toEqual(['one two ', 'three ', 'four']);
    expect(texts(l).join('')).toBe('one two three four');
    expect(l).toMatchObject({ cursorRow: 2, cursorCol: 4 });
  });

  it('splits a word longer than the row', () => {
    expect(texts(layoutPrompt('abcdefghij', 0, 4, 6))).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('starts a row for each newline', () => {
    const l = layoutPrompt('a\n\nb', 4, 20, 6);
    expect(texts(l)).toEqual(['a', '', 'b']);
    expect(l).toMatchObject({ cursorRow: 2, cursorCol: 1 });
  });

  it('puts the cursor at the start of the next row when it sits on a soft wrap', () => {
    const l = layoutPrompt('abcdefgh', 4, 4, 6);
    expect(l).toMatchObject({ cursorRow: 1, cursorCol: 0 });
  });

  it('shows a window of rows that holds the cursor row', () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    const end = layoutPrompt(text, text.length, 20, 4);
    expect(texts(end)).toEqual(['l6', 'l7', 'l8', 'l9']);
    expect(end).toMatchObject({ total: 10, cursorRow: 3 });
    const start = layoutPrompt(text, 0, 20, 4);
    expect(texts(start)).toEqual(['l0', 'l1', 'l2', 'l3']);
    expect(start.cursorRow).toBe(0);
  });

  it('counts wide characters as two cells', () => {
    const l = layoutPrompt('日本語日本語', 3, 6, 6);
    expect(texts(l)).toEqual(['日本語', '日本語']);
    expect(l).toMatchObject({ cursorRow: 1, cursorCol: 0 });
  });
});

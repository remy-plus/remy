import { describe, expect, it } from 'vitest';
import { cursorPosition } from './input-cursor.ts';

describe('cursorPosition', () => {
  it('counts rows and columns across newlines', () => {
    expect(cursorPosition('', 0, 10)).toEqual({ row: 0, col: 0 });
    expect(cursorPosition('abc\nde', 6, 10)).toEqual({ row: 1, col: 2 });
    expect(cursorPosition('abc\n', 4, 10)).toEqual({ row: 1, col: 0 });
  });

  it('wraps long lines at the width', () => {
    expect(cursorPosition('abcdefghij', 7, 4)).toEqual({ row: 1, col: 3 });
    expect(cursorPosition('abcd', 4, 4)).toEqual({ row: 1, col: 0 });
    expect(cursorPosition('abcdefgh\nxy', 11, 4)).toEqual({ row: 2, col: 2 });
    expect(cursorPosition('\n\nz', 3, 4)).toEqual({ row: 2, col: 1 });
  });
});

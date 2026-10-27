import { describe, expect, it } from 'vitest';
import { splitHint } from './hints.ts';

describe('splitHint', () => {
  it('takes the first word of each part as its key', () => {
    expect(splitHint('Enter send · / commands · Ctrl+P menu')).toEqual([
      ['Enter', 'send'],
      ['/', 'commands'],
      ['Ctrl+P', 'menu'],
    ]);
    expect(splitHint('Esc')).toEqual([['Esc', '']]);
    expect(splitHint('')).toEqual([]);
  });
});

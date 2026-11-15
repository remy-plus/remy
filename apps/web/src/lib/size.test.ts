import { describe, expect, it } from 'vitest';
import { fileSize } from './size.ts';

describe('fileSize', () => {
  it.each([
    [0, '0 B'],
    [16, '16 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [1500, '1.5 KB'],
    [52000, '52 KB'],
    [3_200_000, '3.2 MB'],
    [25_000_000, '25 MB'],
  ])('%s -> %s', (n, text) => expect(fileSize(n)).toBe(text));
  it('says nothing for a size that makes no sense', () => {
    expect(fileSize(-1)).toBe('');
    expect(fileSize(Number.NaN)).toBe('');
  });
});

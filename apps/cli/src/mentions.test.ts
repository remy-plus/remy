import { describe, expect, it } from 'vitest';
import {
  applyMention,
  atToken,
  completePaths,
  fileContext,
  MAX_FILE_CHARS,
  mentionedPaths,
} from './mentions.ts';

describe('@ mentions', () => {
  it('finds the word under the cursor', () => {
    expect(atToken('look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' });
    expect(atToken('@', 1)).toEqual({ start: 0, query: '' });
    expect(atToken('mail me@example.com', 19)).toBeUndefined();
    expect(atToken('look at @a b', 12)).toBeUndefined();
  });

  it('completes a file with a space and a folder without', () => {
    expect(applyMention('read @no please', 8, 'notes.txt')).toEqual({
      text: 'read @notes.txt  please',
      cursor: 16,
    });
    expect(applyMention('@s', 2, 'src/')).toEqual({ text: '@src/', cursor: 5 });
  });

  it('lists the paths a message mentions, once, without folders or trailing punctuation', () => {
    expect(mentionedPaths('compare @a.txt and @b/c.md, then @a.txt and @dir/ and me@x.io')).toEqual(
      ['a.txt', 'b/c.md'],
    );
  });

  it('cuts a long file and says so', () => {
    expect(fileContext('short\n')).toBe('short');
    const long = fileContext('x'.repeat(MAX_FILE_CHARS + 5));
    expect(long).toContain('[cut: first 20000 of 20005 characters]');
  });

  it('completes within a folder, folders first, hiding dotfiles', async () => {
    const tree: Record<string, { name: string; dir: boolean }[]> = {
      '.': [
        { name: 'notes.txt', dir: false },
        { name: 'src', dir: true },
        { name: '.env', dir: false },
      ],
      'src/': [{ name: 'main.ts', dir: false }],
    };
    const fs = { list: async (p: string) => tree[p] ?? Promise.reject(new Error('no')) };
    expect(await completePaths(fs, '')).toEqual(['src/', 'notes.txt']);
    expect(await completePaths(fs, 'no')).toEqual(['notes.txt']);
    expect(await completePaths(fs, 'src/m')).toEqual(['src/main.ts']);
    expect(await completePaths(fs, 'nope/x')).toEqual([]);
  });
});

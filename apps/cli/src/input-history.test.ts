import { describe, expect, it } from 'vitest';
import {
  currentMatch,
  SEARCH_START,
  type SearchState,
  searchKey,
  searchMatches,
} from './input-history.ts';

const history = [
  'fix the build',
  'draft email',
  'Fix the tests',
  'summarize notes',
  'fix the build',
];

const step = (st: SearchState, input: string, key = {}) => {
  const r = searchKey(st, history, input, key);
  if (!('state' in r)) throw new Error('expected a state');
  return r.state;
};

describe('reverse history search', () => {
  it('lists matches newest first, ignoring case and repeats', () => {
    expect(searchMatches(history, 'fix')).toEqual(['fix the build', 'Fix the tests']);
    expect(searchMatches(history, '')).toHaveLength(4);
    expect(searchMatches(history, 'zzz')).toEqual([]);
  });

  it('typing narrows the query and shows the newest match', () => {
    let s = step(SEARCH_START, 'e');
    s = step(s, 'm');
    expect(s.query).toBe('em');
    expect(currentMatch(s, history)).toBe('draft email');
    s = step(s, '', { backspace: true });
    expect(s).toEqual({ query: 'e', index: 0 });
  });

  it('Ctrl+R steps to older matches and wraps', () => {
    let s = step(SEARCH_START, 'fix');
    s = step(s, 'r', { ctrl: true });
    expect(currentMatch(s, history)).toBe('Fix the tests');
    s = step(s, 'r', { ctrl: true });
    expect(currentMatch(s, history)).toBe('fix the build');
  });

  it('Enter, Tab and Right accept; Esc, Ctrl+G and no match cancel', () => {
    const s = step(SEARCH_START, 'draft');
    expect(searchKey(s, history, '', { return: true })).toEqual({ accept: 'draft email' });
    expect(searchKey(s, history, '', { tab: true })).toEqual({ accept: 'draft email' });
    expect(searchKey(s, history, '', { escape: true })).toEqual({ cancel: true });
    expect(searchKey(s, history, 'g', { ctrl: true })).toEqual({ cancel: true });
    const none = step(SEARCH_START, 'zzz');
    expect(searchKey(none, history, '', { return: true })).toEqual({ cancel: true });
  });
});

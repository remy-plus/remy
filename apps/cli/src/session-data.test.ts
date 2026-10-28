import { describe, expect, it } from 'vitest';
import { changedPaths, sessionTitle, touchFiles, workspacePath } from './session-data.ts';

describe('session data', () => {
  it('makes a one-line title of at most 48 characters, without pasted text', () => {
    expect(sessionTitle('  tidy\nmy   notes ')).toBe('tidy my notes');
    expect(sessionTitle('x'.repeat(100))).toHaveLength(48);
    expect(sessionTitle('summarize BIG PASTE please', ['BIG PASTE'])).toBe('summarize please');
  });
  it('makes paths workspace-relative', () => {
    expect(workspacePath('./a/b.txt')).toBe('a/b.txt');
    expect(workspacePath('/w/a/b.txt', '/w')).toBe('a/b.txt');
    expect(workspacePath('/etc/x', '/w')).toBe('/etc/x');
  });
  it('knows which calls change files', () => {
    expect(changedPaths('write_file', { path: 'a' })).toEqual(['a']);
    expect(changedPaths('move_file', { from: 'a', to: 'b' })).toEqual(['a', 'b']);
    expect(changedPaths('read_file', { path: 'a' })).toEqual([]);
  });
  it('counts edits, newest first, capped', () => {
    let l = touchFiles([], ['a']);
    l = touchFiles(l, ['b']);
    l = touchFiles(l, ['a']);
    expect(l).toEqual([
      { path: 'a', edits: 2 },
      { path: 'b', edits: 1 },
    ]);
    expect(touchFiles(l, ['c', 'd'], 3).map((f) => f.path)).toEqual(['d', 'c', 'a']);
  });
});

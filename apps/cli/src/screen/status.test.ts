import { describe, expect, it } from 'vitest';
import { shortenPath, statusLine } from './status.ts';

describe('shortenPath', () => {
  it('uses ~ for the home folder and keeps both ends of a long path', () => {
    expect(shortenPath('/Users/me/proj', 40, '/Users/me')).toBe('~/proj');
    const long = shortenPath(
      '/Users/me/a/very/deep/folder/structure/that/goes/on/and/on',
      30,
      '/x',
    );
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long).toContain('…');
    expect(long.endsWith('on/and/on')).toBe(true);
  });
});

describe('statusLine', () => {
  const idle = { workspace: '/w/proj', contextPct: 23, costUsd: 0.123 };
  it('shows the workspace on the left and figures and the palette key on the right', () => {
    expect(statusLine({ ...idle, width: 80 })).toEqual({
      left: '/w/proj',
      hint: '',
      right: '23% · $0.12 · ctrl+p commands',
    });
  });

  it('shows the narration and the interrupt hint while working', () => {
    const s = statusLine({
      ...idle,
      width: 80,
      working: { spinner: '⠋', narration: 'Reading notes.txt' },
    });
    expect(s.left).toBe('⠋ Reading notes.txt');
    expect(s.hint).toBe('esc interrupt');
  });

  it('hides a zero cost and an unknown context', () => {
    expect(statusLine({ width: 80, workspace: '/w', costUsd: 0 }).right).toBe('ctrl+p commands');
  });

  it('drops the hint, then cost, then context as the width shrinks', () => {
    const working = { spinner: '⠋', narration: 'Reading notes.txt' };
    const at = (width: number) => statusLine({ ...idle, width, working });
    expect(at(60)).toMatchObject({ hint: '', right: '23% · $0.12 · ctrl+p commands' });
    expect(at(49).right).toBe('23% · ctrl+p commands');
    expect(at(40).right).toBe('ctrl+p commands');
    expect(at(10)).toEqual({ left: '', hint: '', right: '' });
  });

  it('cuts a long left side to what is left', () => {
    const s = statusLine({
      ...idle,
      width: 50,
      working: { spinner: '⠋', narration: 'Reading a very long file name that goes on'.repeat(2) },
    });
    expect(s.left.endsWith('…')).toBe(true);
    expect(s.left.length + s.right.length + 2).toBeLessThanOrEqual(50);
  });
});

describe('status line send-now hint', () => {
  const working = { spinner: '⠋', narration: 'Reading' };
  it('adds ctrl+s send now to the hint when something is typed', () => {
    const s = statusLine({ width: 100, workspace: '/w', working, hasInput: true });
    expect(s.hint).toBe('esc interrupt · ctrl+s send now');
    expect(statusLine({ width: 100, workspace: '/w', working }).hint).toBe('esc interrupt');
  });
  it('falls back to the short hint when the width is tight', () => {
    const s = statusLine({ width: 36, workspace: '/w', working, hasInput: true });
    expect(s.hint).not.toContain('send now');
  });
});

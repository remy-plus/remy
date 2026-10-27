import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { styler } from './format.ts';
import { ansi, createTheme, detectColor } from './theme.ts';
import { WORDMARK } from './wordmark.ts';

describe('detectColor', () => {
  it('turns color off for NO_COLOR, FORCE_COLOR=0, dumb terminals and pipes', () => {
    expect(detectColor({ NO_COLOR: '1' }, true)).toBe('none');
    expect(detectColor({ FORCE_COLOR: '0' }, true)).toBe('none');
    expect(detectColor({ TERM: 'dumb' }, true)).toBe('none');
    expect(detectColor({}, false)).toBe('none');
  });
  it('uses 16 colors unless the terminal says truecolor', () => {
    expect(detectColor({ TERM: 'xterm-256color' }, true)).toBe('basic');
    expect(detectColor({ COLORTERM: 'truecolor' }, true)).toBe('truecolor');
    expect(detectColor({ FORCE_COLOR: '1' }, false)).toBe('basic');
  });
});

describe('theme', () => {
  it('ramps the wordmark in truecolor only', () => {
    const t = createTheme('truecolor');
    expect(t.ramp(0, 6)).toBe('#b9b6af');
    expect(t.ramp(5, 6)).toBe('#edebe6');
    expect(createTheme('basic').ramp(0, 6)).toBeUndefined();
  });
  it('has error and diff roles: clay in truecolor, red or green in basic, none without color', () => {
    const t = createTheme('truecolor');
    expect(t.color('diffAdd')).toBe('#A8C49A');
    expect(t.color('diffDel')).toBe(t.color('error'));
    expect(t.color('error')).not.toBe(t.color('accent'));
    expect(createTheme('basic').color('diffDel')).toBe('red');
    expect(createTheme('basic').color('diffAdd')).toBe('green');
    expect(createTheme('none').color('error')).toBeUndefined();
    expect(ansi('none', 'error')).toBe('');
    expect(ansi('basic', 'error')).toBe('\x1b[31m');
  });
  it('maps roles per level', () => {
    expect(createTheme('truecolor').color('accent')).toBe('#A8C49A');
    expect(createTheme('basic').color('muted')).toBe('gray');
    expect(createTheme('none').color('accent')).toBeUndefined();
  });
  it('gives props per role: faint structure, inline code on a surface, dim without colour', () => {
    const t = createTheme('truecolor');
    expect(t.props('code')).toMatchObject({ color: '#D6D3CC', backgroundColor: t.surface });
    expect(t.props('faint').color).not.toBe(t.props('muted').color);
    expect(createTheme('basic').props('code')).toEqual({ color: 'cyan' });
    expect(createTheme('none').props('muted')).toEqual({ dimColor: true });
    expect(createTheme('none').props('faint')).toEqual({ dimColor: true });
    expect(createTheme('none').surface).toBeUndefined();
    expect(createTheme('truecolor', 'light').diffSurface('add')).not.toBe(t.diffSurface('add'));
  });
  it('styles plain output by level', () => {
    expect(styler('none').dim('x')).toBe('x');
    expect(styler('basic').dim('x')).toBe('\x1b[90mx\x1b[0m');
  });
});

describe('wordmark', () => {
  it('matches branding/logo/remy-wordmark.txt', () => {
    const file = readFileSync(
      new URL('../../../branding/logo/remy-wordmark.txt', import.meta.url),
      'utf8',
    );
    expect(WORDMARK.join('\n')).toBe(file.replace(/\n$/, ''));
  });
});

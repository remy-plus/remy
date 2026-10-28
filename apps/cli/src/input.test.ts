import { describe, expect, it } from 'vitest';
import {
  EMPTY_INPUT,
  editInput,
  expandPastes,
  type InputState,
  moveLine,
  pasteInput,
  pressEnter,
  recallInput,
  withText,
} from './input.ts';

const at = (text: string, cursor: number): InputState => ({ text, cursor, pastes: {} });
const big = (n: number) => Array.from({ length: n }, (_, i) => `row ${i}`).join('\n');

describe('editInput', () => {
  it('types, moves and deletes at the cursor', () => {
    let s = editInput(EMPTY_INPUT, 'helo', {});
    s = editInput(s, '', { leftArrow: true });
    s = editInput(s, 'l', {});
    expect(s).toMatchObject({ text: 'hello', cursor: 4 });
    s = editInput(s, '', { backspace: true });
    expect(s).toMatchObject({ text: 'helo', cursor: 3 });
    s = editInput(s, '', { delete: true });
    expect(s).toMatchObject({ text: 'heo', cursor: 2 });
  });

  it('ignores control chords', () => {
    expect(editInput(withText('a'), 'x', { ctrl: true })).toEqual(withText('a'));
    expect(editInput(EMPTY_INPUT, '', { backspace: true })).toBe(EMPTY_INPUT);
  });

  it('one-line mode flattens pasted newlines and has no newline key', () => {
    expect(editInput(EMPTY_INPUT, 'a\nb', {}, 'single').text).toBe('a b');
    expect(editInput(withText('ab'), '\n', {}, 'single').text).toBe('ab ');
    expect(pasteInput(EMPTY_INPUT, big(9), 'single').text).not.toContain('Pasted');
  });
});

describe('several lines', () => {
  it('Ctrl+J and a trailing backslash before Enter make a newline', () => {
    expect(editInput(withText('ab'), '\n', {}).text).toBe('ab\n');
    expect(editInput(at('ab', 1), 'j', { ctrl: true }).text).toBe('a\nb');
    const r = pressEnter(withText('line one\\'));
    expect(r).toMatchObject({ state: { text: 'line one\n', cursor: 9 } });
    expect(pressEnter(withText('plain'))).toEqual({ send: 'plain', pasted: [] });
  });

  it('Home, End and Ctrl+U work on the current line', () => {
    const s = at('one\ntwo', 6);
    expect(editInput(s, '', { home: true }).cursor).toBe(4);
    expect(editInput(at('one\ntwo', 4), 'e', { ctrl: true }).cursor).toBe(7);
    expect(editInput(s, 'u', { ctrl: true })).toMatchObject({ text: 'one\no', cursor: 4 });
  });

  it('up and down move between lines and give way to history at the ends', () => {
    const s = at('abc\nde\nfghi', 9);
    const up = moveLine(s, -1);
    expect(up?.cursor).toBe(6);
    const top = moveLine(up as InputState, -1);
    expect(top?.cursor).toBe(2);
    expect(moveLine(top as InputState, -1)).toBeUndefined();
    expect(moveLine(s, 1)).toBeUndefined();
    expect(moveLine(at('ab\ncd', 1), 1)?.cursor).toBe(4);
    expect(moveLine(withText('single'), -1)).toBeUndefined();
  });

  it('deletes a word with Ctrl+W or Alt+Backspace, and kills to the end with Ctrl+K', () => {
    expect(editInput(withText('make a  plan'), 'w', { ctrl: true }).text).toBe('make a  ');
    expect(editInput(withText('make a plan'), '', { backspace: true, meta: true }).text).toBe(
      'make a ',
    );
    expect(editInput(withText('x\n  word'), 'w', { ctrl: true }).text).toBe('x\n  ');
    expect(editInput(at('one two\nthree', 4), 'k', { ctrl: true })).toMatchObject({
      text: 'one \nthree',
      cursor: 4,
    });
    expect(editInput(at('one\nthree', 3), 'k', { ctrl: true }).text).toBe('onethree');
  });
});

describe('word moves', () => {
  const alt = (st: InputState, input: string) => editInput(st, input, { meta: true });

  it('Alt+B / Alt+F and Option+arrows move by word', () => {
    const s = at('one two  three', 14);
    expect(alt(s, 'b').cursor).toBe(9);
    expect(editInput(s, '', { leftArrow: true, meta: true }).cursor).toBe(9);
    expect(alt(at('one two  three', 0), 'f').cursor).toBe(3);
    expect(editInput(at('one two', 3), '', { rightArrow: true, meta: true }).cursor).toBe(7);
    expect(alt(at('ab\ncd', 0), 'f').cursor).toBe(2);
    expect(alt(at('ab\ncd', 2), 'f').cursor).toBe(5);
    expect(alt(at('ab', 0), 'b').cursor).toBe(0);
  });

  it('treats a paste marker as one word', () => {
    const s = pasteInput(withText('a '), big(8));
    expect(alt(s, 'b').cursor).toBe(2);
    expect(alt({ ...s, cursor: 2 }, 'f').cursor).toBe(s.text.length);
  });

  it('Alt+D deletes the word ahead', () => {
    expect(alt(at('one two three', 3), 'd')).toMatchObject({ text: 'one three', cursor: 3 });
    expect(alt(withText('end'), 'd').text).toBe('end');
  });
});

describe('kill and yank', () => {
  it('Ctrl+Y puts back the last Ctrl+K, Ctrl+U, Ctrl+W or Alt+D cut', () => {
    const k = editInput(at('one two', 3), 'k', { ctrl: true });
    expect(k.kill).toBe(' two');
    expect(editInput(editInput(k, '', { home: true }), 'y', { ctrl: true }).text).toBe(' twoone');
    const u = editInput(at('ab\ncd', 5), 'u', { ctrl: true });
    expect(u).toMatchObject({ text: 'ab\n', kill: 'cd' });
    expect(editInput(withText('x yy'), 'w', { ctrl: true }).kill).toBe('yy');
    expect(editInput(at('a bb c', 1), 'd', { meta: true }).kill).toBe(' bb');
    expect(editInput(u, 'y', { ctrl: true })).toMatchObject({ text: 'ab\ncd', cursor: 5 });
  });

  it('Ctrl+Y with nothing killed does nothing', () => {
    expect(editInput(withText('a'), 'y', { ctrl: true })).toEqual(withText('a'));
  });
});

describe('paste', () => {
  it('keeps a small paste as it is, newlines included', () => {
    const s = pasteInput(withText('> '), 'a\r\nb');
    expect(s.text).toBe('> a\nb');
    expect(s.pastes).toEqual({});
  });

  it('turns a long paste into a marker and expands it on send', () => {
    const text = big(12);
    const s = pasteInput(withText('see: '), text);
    expect(s.text).toBe('see: [Pasted ~12 lines]');
    expect(expandPastes(s)).toBe(`see: ${text}`);
    const wide = pasteInput(EMPTY_INPUT, 'x'.repeat(900));
    expect(wide.text).toBe('[Pasted 900 chars]');
    expect(expandPastes(wide)).toHaveLength(900);
  });

  it('turns 3 lines or 150 characters into a marker, and nothing less', () => {
    expect(pasteInput(EMPTY_INPUT, 'a\nb').text).toBe('a\nb');
    expect(pasteInput(EMPTY_INPUT, 'x'.repeat(149)).pastes).toEqual({});
    expect(pasteInput(EMPTY_INPUT, 'a\nb\nc').text).toBe('[Pasted ~3 lines]');
    expect(pasteInput(EMPTY_INPUT, 'x'.repeat(150)).text).toBe('[Pasted 150 chars]');
  });

  it('numbers later pastes so equal-looking markers stay apart', () => {
    let s = pasteInput(EMPTY_INPUT, big(6));
    s = pasteInput(s, `${big(6)}\nlast`);
    expect(s.text).toBe('[Pasted ~6 lines][Pasted ~7 lines #2]');
    expect(expandPastes(s)).toBe(`${big(6)}${big(6)}\nlast`);
  });

  it('deletes a marker whole, from either side', () => {
    const s = pasteInput(withText('a '), big(8));
    expect(editInput(s, '', { backspace: true }).text).toBe('a ');
    expect(editInput(s, 'w', { ctrl: true }).text).toBe('a ');
    const before = { ...s, cursor: 2 };
    expect(editInput(before, '', { backspace: true }).text).toBe('a[Pasted ~8 lines]');
  });

  it('brings a recalled big message back as a marker', () => {
    const r = recallInput(big(7));
    expect(r.text).toBe('[Pasted ~7 lines]');
    expect(expandPastes(r)).toBe(big(7));
    expect(recallInput('short').text).toBe('short');
  });
});

import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, editInput, withText } from './input.ts';

describe('editInput', () => {
  it('types, moves and deletes at the cursor', () => {
    let s = editInput(EMPTY_INPUT, 'helo', {});
    s = editInput(s, '', { leftArrow: true });
    s = editInput(s, 'l', {});
    expect(s).toEqual({ text: 'hello', cursor: 4 });
    s = editInput(s, '', { backspace: true });
    expect(s).toEqual({ text: 'helo', cursor: 3 });
    s = editInput(s, '', { delete: true });
    expect(s).toEqual({ text: 'heo', cursor: 2 });
  });

  it('ignores control chords and flattens pasted newlines', () => {
    expect(editInput(withText('a'), 'x', { ctrl: true })).toEqual(withText('a'));
    expect(editInput(EMPTY_INPUT, 'a\nb', {}).text).toBe('a b');
    expect(editInput(EMPTY_INPUT, '', { backspace: true })).toBe(EMPTY_INPUT);
  });
});

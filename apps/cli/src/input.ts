// Line editing for the chat input, as plain functions so they can be tested without Ink.

export interface InputState {
  text: string;
  cursor: number;
}

export const EMPTY_INPUT: InputState = { text: '', cursor: 0 };

/** The subset of Ink's `Key` the editor reads. */
export interface EditKey {
  leftArrow?: boolean;
  rightArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export const withText = (text: string): InputState => ({ text, cursor: text.length });

/** Applies one key press. Returns the same state when the key does nothing. */
export function editInput(st: InputState, input: string, key: EditKey): InputState {
  const { text, cursor } = st;
  if (key.leftArrow) return { text, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow) return { text, cursor: Math.min(text.length, cursor + 1) };
  if (key.home || (key.ctrl && input === 'a')) return { text, cursor: 0 };
  if (key.end || (key.ctrl && input === 'e')) return { text, cursor: text.length };
  if (key.ctrl && input === 'u') return { text: text.slice(cursor), cursor: 0 };
  // Terminals send DEL (0x7f) for the Backspace key, and Ink reports that as `delete`.
  if (key.backspace || key.delete) {
    if (cursor === 0) return st;
    return { text: text.slice(0, cursor - 1) + text.slice(cursor), cursor: cursor - 1 };
  }
  if (key.ctrl || key.meta || !input) return st;
  // Pasted newlines become spaces: one message per Enter.
  const clean = input.replace(/\r?\n|\r/g, ' ');
  return {
    text: text.slice(0, cursor) + clean + text.slice(cursor),
    cursor: cursor + clean.length,
  };
}

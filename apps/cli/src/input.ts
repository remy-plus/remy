// Line editing for the chat input, as plain functions so they can be tested without Ink.
// The text may hold several lines ("\n"). A large paste is not put into the text: a marker like
// `[Pasted ~120 lines]` stands for it, and the real text comes back when the message is sent.

export interface InputState {
  text: string;
  cursor: number;
  /** Large pastes by id. The text holds a marker for each; `expandPastes` swaps them back. */
  pastes: Record<number, string>;
  /** The last text cut by a kill key (Ctrl+W/U/K, Alt+D, Alt+Backspace); Ctrl+Y puts it back. */
  kill?: string;
  /** Earlier states for Ctrl+Z, oldest first, at most `UNDO_LIMIT`. */
  undo?: Snapshot[];
  /** States undone, for Alt+Z; cleared by the next edit. */
  redo?: Snapshot[];
  /** True while the last edit was a typed character, so the next one joins the same undo step. */
  typing?: boolean;
}

interface Snapshot {
  text: string;
  cursor: number;
  pastes: Record<number, string>;
}

export const UNDO_LIMIT = 100;

export const EMPTY_INPUT: InputState = { text: '', cursor: 0, pastes: {} };

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
  return?: boolean;
}

/** `multi` is the default editor; `single` keeps the old one-line behaviour (REMY_INPUT=single). */
export type InputMode = 'multi' | 'single';

/** A paste of this many lines, or this many characters, becomes a marker. */
export const PASTE_LINES = 3;
export const PASTE_CHARS = 150;

export const withText = (text: string): InputState => ({ text, cursor: text.length, pastes: {} });

const MARKER = /\[Pasted (?:~\d+ lines?|\d+ chars)(?: #(\d+))?\]/g;

const lineCount = (s: string) => s.split('\n').length;
const isBig = (s: string) => lineCount(s) >= PASTE_LINES || s.length >= PASTE_CHARS;

/** Line endings of any kind become "\n". */
export const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');

const insert = (st: InputState, s: string): InputState => ({
  ...st,
  text: st.text.slice(0, st.cursor) + s + st.text.slice(st.cursor),
  cursor: st.cursor + s.length,
});

/** Puts pasted text in: small ones as they are, big ones as a marker. */
export function pasteInput(st: InputState, raw: string, mode: InputMode = 'multi'): InputState {
  const next = pasteText(st, raw, mode);
  return next.text === st.text ? st : recordEdit(st, next, false, false);
}

function pasteText(st: InputState, raw: string, mode: InputMode): InputState {
  const s = normalizeNewlines(raw);
  if (mode === 'single') return insert(st, s.replace(/\n/g, ' '));
  if (!isBig(s)) return insert(st, s);
  const ids = Object.keys(st.pastes).map(Number);
  const id = ids.length ? Math.max(...ids) + 1 : 1;
  const n = lineCount(s);
  const what = n >= PASTE_LINES ? `~${n} lines` : `${s.length} chars`;
  const marker = `[Pasted ${what}${id > 1 ? ` #${id}` : ''}]`;
  return { ...insert(st, marker), pastes: { ...st.pastes, [id]: s } };
}

/** Recalled history: text that would have been a paste comes back as one marker. */
export const recallInput = (text: string): InputState =>
  isBig(text) ? pasteText(EMPTY_INPUT, text, 'multi') : withText(text);

/** The message to send: markers swapped for the text they stand for. */
export function expandPastes(st: InputState): string {
  return st.text.replace(MARKER, (m, id) => st.pastes[id ? Number(id) : 1] ?? m);
}

/** The pasted texts a message holds, for the ones whose markers are still in it. */
export function pastedSegments(st: InputState): string[] {
  const out: string[] = [];
  st.text.replace(MARKER, (m, id) => {
    const seg = st.pastes[id ? Number(id) : 1];
    if (seg !== undefined) out.push(seg);
    return m;
  });
  return out;
}

/** The marker that ends exactly at `at`, or the one that starts there. */
function markerAt(
  text: string,
  at: number,
  side: 'before' | 'after',
): [number, number] | undefined {
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (side === 'before' && end === at) return [start, end];
    if (side === 'after' && start === at) return [start, end];
  }
  return undefined;
}

const lineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const i = text.indexOf('\n', at);
  return i < 0 ? text.length : i;
};

const cut = (st: InputState, from: number, to: number): InputState => ({
  ...st,
  text: st.text.slice(0, from) + st.text.slice(to),
  cursor: from,
});

/** Cuts a range and remembers it for Ctrl+Y. */
const kill = (st: InputState, from: number, to: number): InputState => ({
  ...cut(st, from, to),
  kill: st.text.slice(from, to),
});

/** Where a word delete from `at` stops: past spaces, then past the word. */
function wordStart(text: string, at: number): number {
  let i = at;
  while (i > 0 && /[ \t]/.test(text[i - 1] as string)) i--;
  const mark = markerAt(text, i, 'before');
  if (mark) return mark[0];
  while (i > 0 && !/\s/.test(text[i - 1] as string)) i--;
  return i;
}

/** Where a word move or delete forward from `at` stops: past spaces and newlines, then past the word. */
function wordEnd(text: string, at: number): number {
  let i = at;
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  const mark = markerAt(text, i, 'after');
  if (mark) return mark[1];
  while (i < text.length && !/\s/.test(text[i] as string)) i++;
  return i;
}

/** Moves up or down a line, keeping the column. Undefined on the first or last line. */
export function moveLine(st: InputState, dir: -1 | 1): InputState | undefined {
  const { text, cursor } = st;
  const start = lineStart(text, cursor);
  const col = cursor - start;
  if (dir === -1) {
    if (start === 0) return undefined;
    const prevStart = lineStart(text, start - 1);
    return { ...st, cursor: Math.min(prevStart + col, start - 1) };
  }
  const end = lineEnd(text, cursor);
  if (end >= text.length) return undefined;
  const nextEnd = lineEnd(text, end + 1);
  return { ...st, cursor: Math.min(end + 1 + col, nextEnd) };
}

/** What Enter does: a trailing backslash turns it into a newline, otherwise it sends. */
export function pressEnter(
  st: InputState,
): { send: string; pasted: string[] } | { state: InputState } {
  if (st.text[st.cursor - 1] === '\\')
    return { state: insert(cut(st, st.cursor - 1, st.cursor), '\n') };
  return { send: expandPastes(st), pasted: pastedSegments(st) };
}

/** Applies one key press. Returns the same state when the key does nothing. */
export function editInput(
  st: InputState,
  input: string,
  key: EditKey,
  mode: InputMode = 'multi',
): InputState {
  if (key.ctrl && (input === 'z' || input === '_')) return undoInput(st);
  if (key.meta && !key.ctrl && input === 'z') return redoInput(st);
  const next = applyKey(st, input, key, mode);
  if (next === st) return st;
  if (next.text === st.text) return { ...next, typing: false };
  const typing = !key.ctrl && !key.meta && !!input && !input.includes('\n');
  return recordEdit(st, next, typing && st.typing === true, typing);
}

const snap = (st: InputState): Snapshot => ({
  text: st.text,
  cursor: st.cursor,
  pastes: st.pastes,
});

/** `next` as the result of an edit to `prev`: pushes `prev` for undo unless this edit joins the last. */
function recordEdit(
  prev: InputState,
  next: InputState,
  join: boolean,
  typing: boolean,
): InputState {
  const undo = join ? (prev.undo ?? []) : [...(prev.undo ?? []), snap(prev)].slice(-UNDO_LIMIT);
  return { ...next, undo, redo: [], typing };
}

/** Ctrl+Z: back to the state before the last edit (a run of typed characters is one edit). */
export function undoInput(st: InputState): InputState {
  const undo = st.undo ?? [];
  const prev = undo[undo.length - 1];
  if (!prev) return st;
  return {
    ...st,
    ...prev,
    undo: undo.slice(0, -1),
    redo: [...(st.redo ?? []), snap(st)],
    typing: false,
  };
}

/** Alt+Z: puts back what Ctrl+Z took away. */
export function redoInput(st: InputState): InputState {
  const redo = st.redo ?? [];
  const next = redo[redo.length - 1];
  if (!next) return st;
  return {
    ...st,
    ...next,
    redo: redo.slice(0, -1),
    undo: [...(st.undo ?? []), snap(st)],
    typing: false,
  };
}

function applyKey(st: InputState, input: string, key: EditKey, mode: InputMode): InputState {
  const { text, cursor } = st;
  const multi = mode === 'multi';
  // Word moves: Alt+B / Alt+F, and Option or Ctrl with the arrows (Ink sets `meta` for Alt).
  if ((key.leftArrow && (key.meta || key.ctrl)) || (key.meta && !key.ctrl && input === 'b'))
    return { ...st, cursor: wordStart(text, cursor) };
  if ((key.rightArrow && (key.meta || key.ctrl)) || (key.meta && !key.ctrl && input === 'f'))
    return { ...st, cursor: wordEnd(text, cursor) };
  if (multi && key.meta && !key.ctrl && input === 'd') {
    const to = wordEnd(text, cursor);
    return to === cursor ? st : kill(st, cursor, to);
  }
  if (key.leftArrow) return { ...st, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow) return { ...st, cursor: Math.min(text.length, cursor + 1) };
  if (key.home || (key.ctrl && input === 'a'))
    return { ...st, cursor: multi ? lineStart(text, cursor) : 0 };
  if (key.end || (key.ctrl && input === 'e'))
    return { ...st, cursor: multi ? lineEnd(text, cursor) : text.length };
  if (key.ctrl && input === 'u') {
    const from = multi ? lineStart(text, cursor) : 0;
    return cursor === from ? st : kill(st, from, cursor);
  }
  if (multi && key.ctrl && input === 'k') {
    const end = lineEnd(text, cursor);
    // At the end of a line, Ctrl+K joins the next one.
    const to = end === cursor && end < text.length ? end + 1 : end;
    return to === cursor ? st : kill(st, cursor, to);
  }
  if (multi && key.ctrl && input === 'y') return st.kill ? insert(st, st.kill) : st;
  if (multi && ((key.ctrl && input === 'w') || (key.meta && (key.backspace || key.delete)))) {
    return cursor === 0 ? st : kill(st, wordStart(text, cursor), cursor);
  }
  // Ctrl+J: a line feed that is not Enter.
  if (multi && ((key.ctrl && input === 'j') || (!key.return && input === '\n')))
    return insert(st, '\n');
  // Terminals send DEL (0x7f) for the Backspace key, and Ink reports that as `delete`.
  if (key.backspace || key.delete) {
    if (cursor === 0) return st;
    const mark = multi ? markerAt(text, cursor, 'before') : undefined;
    return mark ? cut(st, mark[0], mark[1]) : cut(st, cursor - 1, cursor);
  }
  if (key.ctrl || key.meta || !input) return st;
  // One-line mode: pasted newlines become spaces, one message per Enter.
  return multi ? insert(st, normalizeNewlines(input)) : insert(st, input.replace(/\r?\n|\r/g, ' '));
}

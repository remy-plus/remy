// Reverse history search (Ctrl+R) as plain state. The history is passed in, oldest first, the way the
// chat keeps it; nothing here holds on to it.

export interface SearchState {
  query: string;
  /** Which match is showing: 0 is the newest, Ctrl+R again goes one older. */
  index: number;
}

export const SEARCH_START: SearchState = { query: '', index: 0 };

/** The subset of Ink's `Key` the search reads. */
export interface SearchKey {
  ctrl?: boolean;
  meta?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  rightArrow?: boolean;
  leftArrow?: boolean;
}

/** History entries that contain the query (ignoring case), newest first, without repeats. */
export function searchMatches(history: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i] as string;
    if (seen.has(h) || !h.toLowerCase().includes(q)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** The entry the search is showing, if any matches. */
export const currentMatch = (st: SearchState, history: readonly string[]): string | undefined =>
  searchMatches(history, st.query)[st.index];

export type SearchStep = { state: SearchState } | { accept: string } | { cancel: true };

/**
 * One key in search mode. Enter, Tab and Right accept the match into the input (to edit, not send);
 * Esc, Ctrl+G and Ctrl+C cancel; Ctrl+R shows the next older match; typing narrows the query.
 */
export function searchKey(
  st: SearchState,
  history: readonly string[],
  input: string,
  key: SearchKey,
): SearchStep {
  if (key.escape || (key.ctrl && (input === 'g' || input === 'c'))) return { cancel: true };
  if (key.return || key.tab || key.rightArrow || key.leftArrow) {
    const m = currentMatch(st, history);
    return m === undefined ? { cancel: true } : { accept: m };
  }
  if (key.ctrl && input === 'r') {
    const count = searchMatches(history, st.query).length;
    return { state: { ...st, index: count ? (st.index + 1) % count : 0 } };
  }
  if (key.backspace || key.delete) {
    return { state: { query: st.query.slice(0, -1), index: 0 } };
  }
  if (key.ctrl || key.meta || !input) return { state: st };
  return { state: { query: st.query + input.replace(/[\r\n]+/g, ' '), index: 0 } };
}

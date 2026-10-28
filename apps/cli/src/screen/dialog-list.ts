// The list inside a centered dialog: search field, optional category headers, windowed rows.
// `dialogKey` is the pure key reducer; the caller owns the state and acts on the result.
import { Box, Text } from 'ink';
import { createElement as h, type ReactElement } from 'react';
import { filterItems, matchSpans, windowAround } from '../picker.ts';
import { moveSelection } from '../session-picker.ts';
import type { Theme } from '../theme.ts';

export interface DialogItem {
  id: string;
  title: string;
  /** Muted text at the right edge of the row. */
  detail?: string;
  /** Category header; items sharing one are listed together while the query is empty. */
  group?: string;
}

export interface DialogState {
  query: string;
  /** Index into `shownItems`. */
  at: number;
}

export const initialDialogState: DialogState = { query: '', at: 0 };

/** The keys `dialogKey` reads (a subset of Ink's `Key`). */
export interface DialogKey {
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  tab?: boolean;
}

export type DialogAction = { type: 'pick'; item: DialogItem } | { type: 'close' };

/** Items in display order: ranked by match while searching, otherwise grouped (first seen first). */
export function shownItems(items: DialogItem[], query: string): DialogItem[] {
  const hits = filterItems(items, query) as DialogItem[];
  if (query.trim() || !hits.some((i) => i.group)) return hits;
  const order: string[] = [];
  for (const i of hits) if (!order.includes(i.group ?? '')) order.push(i.group ?? '');
  return order.flatMap((g) => hits.filter((i) => (i.group ?? '') === g));
}

/**
 * One key press. Returns the next state and, when the key finishes the dialog, what to do.
 * Typing edits the query and returns the highlight to the top.
 */
export function dialogKey(
  state: DialogState,
  input: string,
  key: DialogKey,
  ctx: { items: DialogItem[]; page?: number },
): { state: DialogState; action?: DialogAction } {
  const shown = shownItems(ctx.items, state.query);
  const page = ctx.page ?? 8;
  const move = (by: number) => ({
    state: { ...state, at: moveSelection(state.at, by, shown.length) },
  });
  const clamp = (by: number) => ({
    state: { ...state, at: Math.max(0, Math.min(shown.length - 1, state.at + by)) },
  });
  if (key.escape) return { state, action: { type: 'close' } };
  if (key.return) {
    const item = shown[state.at];
    return item ? { state, action: { type: 'pick', item } } : { state };
  }
  if (key.upArrow || (key.ctrl && input === 'p')) return move(-1);
  if (key.downArrow || (key.ctrl && input === 'n') || key.tab) return move(1);
  if (key.pageUp) return clamp(-page);
  if (key.pageDown) return clamp(page);
  if (key.backspace || key.delete) return { state: { query: state.query.slice(0, -1), at: 0 } };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: filters control input on purpose
  if (key.ctrl || key.meta || !input || /[\x00-\x1f\x7f]/.test(input)) return { state };
  return { state: { query: state.query + input, at: 0 } };
}

type FlatRow = { kind: 'header'; text: string } | { kind: 'item'; item: DialogItem; index: number };

/** Items with a header before each new group (none while searching). */
export function flatRows(shown: DialogItem[], query: string): FlatRow[] {
  const out: FlatRow[] = [];
  let last: string | undefined;
  shown.forEach((item, index) => {
    if (!query.trim() && item.group && item.group !== last) {
      out.push({ kind: 'header', text: item.group });
      last = item.group;
    }
    out.push({ kind: 'item', item, index });
  });
  return out;
}

export function DialogList(p: {
  items: DialogItem[];
  state: DialogState;
  theme: Theme;
  /** Inner width in columns. */
  width: number;
  /** Rows for the list (headers count). */
  rows: number;
  placeholder?: string;
}): ReactElement {
  const { theme, state } = p;
  const muted = theme.props('muted');
  const accent = theme.color('accent');
  const shown = shownItems(p.items, state.query);
  const flat = flatRows(shown, state.query);
  const activeAt = flat.findIndex((r) => r.kind === 'item' && r.index === state.at);
  const { start, end } = windowAround(Math.max(0, activeAt), flat.length, Math.max(1, p.rows));
  return h(
    Box,
    { flexDirection: 'column', width: p.width },
    h(
      Box,
      null,
      state.query ? h(Text, null, state.query) : h(Text, muted, p.placeholder ?? 'Search'),
      h(Text, accent ? { color: accent } : {}, theme.symbols.cursor),
    ),
    h(Box, { height: 1 }),
    shown.length === 0
      ? h(Text, muted, 'No matches')
      : h(
          Box,
          { flexDirection: 'column' },
          ...flat.slice(start, end).map((r) => {
            if (r.kind === 'header') return h(Text, { key: `h:${r.text}`, ...muted }, r.text);
            const on = r.index === state.at;
            return h(
              Box,
              { key: r.item.id, justifyContent: 'space-between' },
              h(
                Text,
                {
                  wrap: 'truncate-end',
                  ...(on && { bold: true }),
                  ...(on && accent && { color: accent }),
                },
                on ? theme.symbols.prompt : ' ',
                ' ',
                ...matchSpans(r.item.title, state.query).map(([text, hit], n) =>
                  h(Text, { key: n, ...(hit && { underline: true }) }, text),
                ),
              ),
              r.item.detail
                ? h(Text, { wrap: 'truncate-end', ...muted }, ` ${r.item.detail}`)
                : null,
            );
          }),
        ),
  );
}

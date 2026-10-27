// One list component for the chat: `Menu` is the plain list (autocomplete under the prompt), and
// `Picker` wraps it with a filter box and keys (the Ctrl+P palette and the /model list).
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, useState } from 'react';
import { fuzzyScore } from './commands.ts';
import { moveSelection } from './session-picker.ts';
import type { Theme } from './theme.ts';

export interface PickItem {
  id: string;
  title: string;
  /** Muted text after the title. */
  detail?: string;
}

/** Rows shown at once. */
export const MENU_ROWS = 8;

/** The slice of `count` rows, at most `max`, that keeps `at` in view. */
export function windowAround(at: number, count: number, max = MENU_ROWS) {
  const start = Math.max(0, Math.min(at - Math.floor(max / 2), count - max));
  return { start, end: Math.min(count, start + max) };
}

/** Items that match `query`, best first; all of them, in order, when it is empty. */
export function filterItems(items: PickItem[], query: string): PickItem[] {
  if (!query.trim()) return items;
  const scored: { i: PickItem; s: number }[] = [];
  for (const i of items) {
    // Ids such as gpt-5-nano match loosely (g5n); sentences only as written.
    const loose = !/\s/.test(i.title) || i.title.toLowerCase().includes(query.trim().toLowerCase());
    const t = loose ? fuzzyScore(query, i.title) : undefined;
    // The title may match loosely; the rest of the row only as written.
    const d = `${i.title} ${i.detail ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
      ? 1
      : undefined;
    const s = t !== undefined ? t + 1000 : d;
    if (s !== undefined) scored.push({ i, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.i);
}

const mutedOf = (theme: Theme) => {
  const color = theme.color('muted');
  return color ? { color } : { dimColor: true };
};

/** How many rows `Menu` takes for this many items. */
export const menuRows = (count: number, max = MENU_ROWS) =>
  Math.min(count, max) + (count > max ? 1 : 0);

export function Menu(p: {
  items: PickItem[];
  at: number;
  theme: Theme;
  max?: number;
  /** Indent in columns; the prompt's text starts at 4. */
  indent?: number;
}): ReactElement | null {
  const { theme, items } = p;
  const max = p.max ?? MENU_ROWS;
  if (!items.length) return null;
  const { start, end } = windowAround(p.at, items.length, max);
  const wide = Math.min(44, Math.max(...items.slice(start, end).map((i) => i.title.length)));
  const muted = mutedOf(theme);
  const accent = theme.color('accent');
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: p.indent ?? theme.space.indent },
    ...items.slice(start, end).map((it, k) => {
      const on = start + k === p.at;
      return h(
        Box,
        { key: it.id },
        h(
          Box,
          { width: 2, flexShrink: 0 },
          h(Text, on && accent ? { color: accent } : muted, on ? theme.symbols.prompt : ' '),
        ),
        h(Text, { wrap: 'truncate-end', ...(on ? { bold: true } : {}) }, it.title.padEnd(wide)),
        it.detail ? h(Text, { wrap: 'truncate-end', ...muted }, `  ${it.detail}`) : null,
      );
    }),
    items.length > max
      ? h(Text, muted, `  ${items.length - max} more. Keep typing to narrow.`)
      : null,
  );
}

export function Picker(p: {
  title: string;
  items: PickItem[];
  theme: Theme;
  /** Rows made from what was typed, shown after the matches (for example "Use this model id"). */
  extra?: (query: string) => PickItem[];
  empty?: string;
  /** Rows shown at once. */
  max?: number;
  onPick: (item: PickItem, query: string) => void;
  onCancel: () => void;
}): ReactElement {
  const { theme } = p;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const shown = [
    ...filterItems(p.items, query),
    ...(query.trim() ? (p.extra?.(query.trim()) ?? []) : []),
  ];
  const cur = Math.min(at, Math.max(0, shown.length - 1));

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === 'c' || input === 'p'))) return p.onCancel();
    if (key.upArrow || (key.ctrl && input === 'k'))
      return setAt(moveSelection(cur, -1, shown.length));
    if (key.downArrow || (key.ctrl && input === 'j') || key.tab)
      return setAt(moveSelection(cur, 1, shown.length));
    if (key.return) {
      const item = shown[cur];
      if (item) p.onPick(item, query.trim());
      return;
    }
    if (key.backspace || key.delete) {
      setAt(0);
      return setQuery((q) => q.slice(0, -1));
    }
    if (key.ctrl || key.meta || !input) return;
    setAt(0);
    setQuery((q) => q + input.replace(/[\r\n]+/g, ''));
  });

  const muted = mutedOf(theme);
  const accent = theme.color('accent');
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    h(Text, { bold: true }, p.title),
    h(
      Box,
      null,
      h(Text, muted, 'Filter  '),
      h(Text, null, query),
      h(Text, accent ? { color: accent } : {}, theme.symbols.cursor),
      query ? null : h(Text, muted, ' type to narrow the list'),
    ),
    shown.length
      ? h(Menu, { items: shown, at: cur, theme, indent: 0, ...(p.max && { max: p.max }) })
      : h(Text, muted, p.empty ?? 'Nothing matches.'),
    h(Text, muted, '↑↓ choose · Enter select · Esc close'),
  );
}

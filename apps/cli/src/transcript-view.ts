// The full transcript, one screenful at a time. Ctrl+O swaps the live area for this view:
// every item, tool details open, scrollable and searchable. It is an ordinary Ink frame
// (no alternate screen), kept shorter than the terminal, and it renders only the rows in view.
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, useState } from 'react';
import type { Item } from './chat.ts';
import { renderMarkdown } from './markdown.ts';
import type { Theme } from './theme.ts';
import { toolBits } from './transcript.ts';

export type ViewRowKind = 'plain' | 'muted' | 'user' | 'add' | 'del';
export interface ViewRow {
  text: string;
  kind: ViewRowKind;
}

export interface ViewState {
  /** Index of the first visible row. */
  top: number;
  /** The confirmed search; empty when none. */
  query: string;
  /** Row indexes that contain the query, ascending. */
  matches: number[];
  /** The search box is open, holding `draft`. */
  typing: boolean;
  draft: string;
}

/** Every item as plain rows, tool details included. A blank row separates messages. */
export function flattenItems(items: Item[], theme: Theme, columns: number): ViewRow[] {
  const pad = ' '.repeat(theme.space.indent);
  const body = Math.max(12, columns - theme.space.indent - 3);
  const out: ViewRow[] = [];
  const gap = () => {
    if (out.length) out.push({ text: '', kind: 'plain' });
  };
  const md = (text: string, kind: ViewRowKind = 'plain', lead?: string) =>
    renderMarkdown(text, body).forEach((l, i) => {
      out.push({
        text: `${pad}${i === 0 && lead ? `${lead} ` : '   '}${l.map((sp) => sp.text).join('')}`.trimEnd(),
        kind,
      });
    });
  const sym = theme.symbols;
  for (const item of items) {
    switch (item.kind) {
      case 'user':
        gap();
        md(item.text, 'user', sym.prompt);
        break;
      case 'reply':
      case 'text':
        gap();
        md(item.text);
        break;
      case 'question':
        gap();
        md(item.text, 'plain', sym.waiting);
        break;
      case 'error':
        gap();
        md(item.text, 'plain', sym.failed);
        break;
      case 'note':
        gap();
        md(item.text, 'muted');
        break;
      case 'plan':
        for (const s of item.steps)
          out.push({
            text: `${pad}${sym[s.status === 'done' ? 'done' : s.status === 'doing' ? 'doing' : 'todo']}  ${s.text}`,
            kind: s.status === 'pending' ? 'muted' : 'plain',
          });
        break;
      case 'tool': {
        const l = item.line;
        const mark = l.state === 'waiting_approval' ? sym.waiting : sym[l.state];
        const bits = toolBits(l);
        out.push({
          text: `${pad}${mark}  ${l.verb} ${l.target}${bits.length ? `  ${bits.join(' · ')}` : ''}`,
          kind: 'plain',
        });
        for (const d of l.detail ?? [])
          out.push({
            text: `${pad}   ${d}`,
            kind: d.startsWith('+ ') ? 'add' : d.startsWith('- ') ? 'del' : 'muted',
          });
        break;
      }
    }
  }
  return out;
}

/** Rows of content in a screen of `rows`: one for the status line, one left free. */
export const viewPage = (rows: number) => Math.max(1, rows - 2);

export const clampTop = (top: number, total: number, page: number) =>
  Math.max(0, Math.min(top, total - page));

/** Indexes of the rows that contain `query`, ignoring case. */
export function findMatches(rows: ViewRow[], query: string): number[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const hits: number[] = [];
  rows.forEach((r, i) => {
    if (r.text.toLowerCase().includes(q)) hits.push(i);
  });
  return hits;
}

/** The match after (dir 1) or before (dir -1) row `from`, wrapping round. */
export function stepMatch(matches: number[], from: number, dir: 1 | -1): number | undefined {
  if (!matches.length) return undefined;
  if (dir === 1) return matches.find((m) => m > from) ?? matches[0];
  return [...matches].reverse().find((m) => m < from) ?? matches[matches.length - 1];
}

/** Opens at the end, where the conversation is. */
export const startState = (total: number, page: number): ViewState => ({
  top: clampTop(total, total, page),
  query: '',
  matches: [],
  typing: false,
  draft: '',
});

export interface ViewKey {
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
}

export type ViewAction = { state: ViewState } | { close: true } | { dump: true };

/** One key press in the view, as a pure step. */
export function viewKey(
  st: ViewState,
  ch: string,
  key: ViewKey,
  rows: ViewRow[],
  page: number,
): ViewAction {
  const total = rows.length;
  const move = (top: number): ViewAction => ({
    state: { ...st, top: clampTop(top, total, page) },
  });
  if (st.typing) {
    if (key.escape) return { state: { ...st, typing: false, draft: '' } };
    if (key.return) {
      const matches = findMatches(rows, st.draft);
      const first = matches.find((m) => m >= st.top) ?? matches[0];
      return {
        state: {
          ...st,
          typing: false,
          query: st.draft,
          matches,
          top: first === undefined ? st.top : clampTop(first, total, page),
        },
      };
    }
    if (key.backspace || key.delete) return { state: { ...st, draft: st.draft.slice(0, -1) } };
    if (key.ctrl || key.meta || !ch) return { state: st };
    return { state: { ...st, draft: st.draft + ch.replace(/[\r\n]+/g, ' ') } };
  }
  if (key.ctrl && ch === 'c') return { close: true };
  if (key.escape && st.query) return { state: { ...st, query: '', matches: [] } };
  if (key.escape || ch === 'q') return { close: true };
  if (ch === '[') return { dump: true };
  if (ch === '/') return { state: { ...st, typing: true, draft: '' } };
  if (ch === 'j' || key.downArrow) return move(st.top + 1);
  if (ch === 'k' || key.upArrow) return move(st.top - 1);
  if (ch === ' ' || key.pageDown) return move(st.top + page - 1);
  if (ch === 'b' || key.pageUp) return move(st.top - page + 1);
  if (ch === 'g') return move(0);
  if (ch === 'G') return move(total);
  if (ch === 'n' || ch === 'N') {
    const at = stepMatch(st.matches, st.top, ch === 'n' ? 1 : -1);
    return at === undefined ? { state: st } : move(at);
  }
  return { state: st };
}

/** Everything as text for the terminal's own scrollback. */
export const dumpText = (rows: ViewRow[]) => `${rows.map((r) => r.text).join('\n')}\n`;

export interface TranscriptViewProps {
  items: Item[];
  columns: number;
  rows: number;
  theme: Theme;
  /** Closes the view. With `dump`, the text to write to the terminal's scrollback first. */
  onClose: (dump?: string) => void;
}

export function TranscriptView(p: TranscriptViewProps): ReactElement {
  const { theme } = p;
  const all = flattenItems(p.items, theme, p.columns);
  const page = viewPage(p.rows);
  const [st, setSt] = useState<ViewState>(() => startState(all.length, page));
  useInput((ch, key) => {
    const act = viewKey(st, ch, key, all, page);
    if ('close' in act) return p.onClose();
    if ('dump' in act) return p.onClose(dumpText(all));
    setSt(act.state);
  });
  const top = clampTop(st.top, all.length, page);
  const shown = all.slice(top, top + page);
  const mutedColor = theme.color('muted');
  const muted = mutedColor ? { color: mutedColor } : { dimColor: true };
  const style: Record<ViewRowKind, Record<string, unknown>> = {
    plain: {},
    muted,
    user: { bold: true },
    add: { color: theme.color('diffAdd') },
    del: { color: theme.color('diffDel') },
  };
  const match = new Set(st.matches);
  const last = Math.min(all.length, top + page);
  const hits = st.matches.length;
  const status = st.typing
    ? `/${st.draft}${theme.symbols.cursor}   Enter search · Esc cancel`
    : [
        `${all.length ? top + 1 : 0}-${last} of ${all.length}`,
        st.query ? `"${st.query}": ${hits} ${hits === 1 ? 'match' : 'matches'}` : '',
        'j/k scroll · / search · [ to scrollback · q back',
      ]
        .filter(Boolean)
        .join(' · ');
  const lines = shown.map((r, i) =>
    h(
      Text,
      {
        key: top + i,
        wrap: 'truncate-end',
        ...style[r.kind],
        ...(match.has(top + i) && { inverse: true }),
      },
      r.text || ' ',
    ),
  );
  while (lines.length < page) lines.push(h(Text, { key: `pad${lines.length}` }, ' '));
  return h(
    Box,
    { flexDirection: 'column', width: p.columns },
    ...lines,
    h(Text, { wrap: 'truncate-end', ...muted }, `${' '.repeat(theme.space.indent)}${status}`),
  );
}

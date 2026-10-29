// The sidebar of the full-screen terminal: session title, context, plan and files, model at the
// foot. Pure props in, one column out; sections that do not fit the height drop from the bottom.
import { Box, Text } from 'ink';
import { createElement as h, type ReactElement } from 'react';
import type { ChatState } from '../chat.ts';
import type { Theme } from '../theme.ts';

export type SidebarState = Pick<
  ChatState,
  | 'title'
  | 'contextTokens'
  | 'contextWindow'
  | 'inTokens'
  | 'cachedTokens'
  | 'costUsd'
  | 'taskCostUsd'
  | 'budgetUsd'
  | 'plan'
  | 'filesTouched'
  | 'model'
>;

export const SIDEBAR_WIDTH = 42;
/** The sidebar sits beside the chat only on terminals wider than this. */
export const SIDEBAR_MIN_COLUMNS = 120;
const MAX_PLAN = 8;
const MAX_FILES = 10;
const ELLIPSIS = '…';

export function sidebarMode(columns: number): 'inline' | 'hidden' {
  return columns > SIDEBAR_MIN_COLUMNS ? 'inline' : 'hidden';
}

/** Cuts a path from the left so the file name survives: `…deep/file.ts`. Result fits `max`. */
export function shortenPath(path: string, max: number): string {
  if (max <= 0) return '';
  if (path.length <= max) return path;
  if (max === 1) return ELLIPSIS;
  return ELLIPSIS + path.slice(path.length - (max - 1));
}

/** Cells of a bar `width` wide, filled to `used / total`; at least one once anything is used. */
export function contextBar(
  used: number,
  total: number | undefined,
  width: number,
): { filled: number; empty: number } {
  if (!total || total <= 0 || width <= 0) return { filled: 0, empty: Math.max(0, width) };
  const ratio = Math.min(1, Math.max(0, used / total));
  const filled = used > 0 ? Math.min(width, Math.max(1, Math.round(ratio * width))) : 0;
  return { filled, empty: width - filled };
}

/** Wraps on spaces to at most `lines` lines of `width`; the last one ends in an ellipsis if cut. */
export function wrapTitle(text: string, width: number, lines = 2): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest && out.length < lines) {
    if (rest.length <= width) {
      out.push(rest);
      break;
    }
    if (out.length === lines - 1) {
      out.push(rest.slice(0, Math.max(0, width - 1)).trimEnd() + ELLIPSIS);
      break;
    }
    const cut = rest.lastIndexOf(' ', width);
    const at = cut > 0 ? cut : width;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  return out;
}

const money = (x: number) => (x <= 0 ? '$0' : x < 0.01 ? '<$0.01' : `$${x.toFixed(2)}`);

export function contextLines(s: SidebarState): { tokens: string; cost: string } {
  const pct =
    s.contextWindow && s.contextTokens > 0
      ? ` · ${Math.min(100, Math.round((s.contextTokens / s.contextWindow) * 100))}% used`
      : '';
  const cost =
    s.budgetUsd !== undefined
      ? `${money(s.taskCostUsd)} of $${s.budgetUsd.toFixed(2)}`
      : `${money(s.costUsd)} spent`;
  const cached =
    s.cachedTokens > 0 && s.inTokens > 0
      ? ` · ${Math.round((s.cachedTokens / s.inTokens) * 100)}% cached`
      : '';
  return { tokens: `${s.contextTokens.toLocaleString('en-US')} tokens${pct}${cached}`, cost };
}

export interface SidebarProps {
  state: SidebarState;
  theme: Theme;
  /** Total rows to fill; sections that do not fit are dropped from the bottom. */
  height: number;
  width?: number;
  /** Panel colour; defaults to a faint surface on truecolor and none elsewhere. */
  background?: string;
}

const PAD_X = 2;
const PAD_Y = 1;

type Node = ReturnType<typeof h>;
interface Section {
  key: string;
  rows: number;
  node: Node;
}

export function Sidebar(p: SidebarProps): ReactElement {
  const { state, theme, height } = p;
  const width = p.width ?? SIDEBAR_WIDTH;
  const inner = Math.max(1, width - PAD_X * 2);
  const background = p.background ?? (theme.level === 'truecolor' ? '#181819' : undefined);
  const muted = theme.props('muted');
  const faint = theme.props('faint');
  const accent = theme.props('accent');
  const heading = (t: string) => h(Text, { key: 'heading', ...muted }, t.toUpperCase());

  const sections: Section[] = [];

  const title = wrapTitle(state.title?.trim() || 'New session', inner);
  sections.push({
    key: 'title',
    rows: title.length,
    node: h(
      Box,
      { key: 'title', flexDirection: 'column' },
      ...title.map((l, i) => h(Text, { key: i, bold: true }, l)),
    ),
  });

  const ctx = contextLines(state);
  const bar = contextBar(state.contextTokens, state.contextWindow, inner);
  const barRow = state.contextWindow
    ? h(
        Text,
        { key: 'bar' },
        h(Text, accent, '▰'.repeat(bar.filled)),
        h(Text, faint, '▱'.repeat(bar.empty)),
      )
    : null;
  sections.push({
    key: 'context',
    rows: 3 + (barRow ? 1 : 0),
    node: h(
      Box,
      { key: 'context', flexDirection: 'column' },
      heading('Context'),
      h(Text, { key: 't', wrap: 'truncate-end' }, ctx.tokens),
      h(Text, { key: 'c', wrap: 'truncate-end', ...muted }, ctx.cost),
      barRow,
    ),
  });

  const plan = state.plan ?? [];
  if (plan.length > 0) {
    const shown = plan.slice(0, MAX_PLAN);
    const hidden = plan.length - shown.length;
    const glyph = {
      pending: theme.symbols.todo,
      doing: theme.symbols.doing,
      done: theme.symbols.done,
    };
    sections.push({
      key: 'plan',
      rows: 1 + shown.length + (hidden ? 1 : 0),
      node: h(
        Box,
        { key: 'plan', flexDirection: 'column' },
        heading('Plan'),
        ...shown.map((s, i) =>
          h(
            Text,
            { key: i, wrap: 'truncate-end', ...(s.status === 'pending' ? muted : {}) },
            h(Text, s.status === 'done' ? accent : {}, `${glyph[s.status]} `),
            h(Text, { bold: s.status === 'doing' }, s.text),
          ),
        ),
        hidden ? h(Text, { key: 'more', ...muted }, `+${hidden} more`) : null,
      ),
    });
  }

  const files = state.filesTouched ?? [];
  if (files.length > 0) {
    const shown = files.slice(0, MAX_FILES);
    const hidden = files.length - shown.length;
    sections.push({
      key: 'files',
      rows: 1 + shown.length + (hidden ? 1 : 0),
      node: h(
        Box,
        { key: 'files', flexDirection: 'column' },
        heading('Files'),
        ...shown.map((f, i) => {
          const count = f.edits > 1 ? `${f.edits}` : '';
          const room = Math.max(1, inner - (count ? count.length + 1 : 0));
          return h(
            Box,
            { key: i, justifyContent: 'space-between' },
            h(Text, null, shortenPath(f.path, room)),
            count ? h(Text, muted, count) : null,
          );
        }),
        hidden ? h(Text, { key: 'more', ...muted }, `+${hidden} more`) : null,
      ),
    });
  }

  // Rows left between the vertical padding, minus the footer and the blank row above it.
  const footer = state.model ? 2 : 0;
  let budget = height - PAD_Y * 2 - footer;
  const body: Node[] = [];
  for (const s of sections) {
    const need = s.rows + (body.length ? 1 : 0);
    if (need > budget) break;
    if (body.length) body.push(h(Text, { key: `gap-${s.key}` }, ' '));
    body.push(s.node);
    budget -= need;
  }

  return h(
    Box,
    {
      flexDirection: 'column',
      width,
      height,
      flexShrink: 0,
      paddingX: PAD_X,
      paddingY: PAD_Y,
      ...(background ? { backgroundColor: background } : {}),
    },
    h(Box, { flexDirection: 'column', flexGrow: 1 }, ...body),
    state.model ? h(Text, { wrap: 'truncate-end', ...muted }, state.model) : null,
  );
}

// The approval card: what Remy wants to do, the exact call, and the keys that answer it.
import { Box, Text } from 'ink';
import { createElement as h, type ReactElement } from 'react';
import { clip } from './markdown.ts';
import type { Theme } from './theme.ts';
import { type ApprovalRow, type ApprovalView, approvalRows } from './transcript.ts';

export function ApprovalCard(p: {
  view: ApprovalView;
  theme: Theme;
  columns: number;
  expanded: boolean;
  /** Rows the expanded card may take. */
  room: number;
  /** The user is typing a note for a denial. */
  noting: boolean;
  /** Columns to the left of the card; the classic screen indents it, the full one does not. */
  indent?: number;
}): ReactElement {
  const { view, theme } = p;
  const { pad } = theme.space;
  const indent = p.indent ?? theme.space.indent;
  // Border (1) and padding on both sides, inside the left margin.
  const inner = Math.max(10, p.columns - indent * 2 - (1 + pad) * 2);
  const fit = (s: string) => clip(s, inner);
  const muted = theme.props('muted');
  const rowProps = (kind: ApprovalRow['kind'], text: string) => {
    if (kind === 'add' || kind === 'del') {
      // A tinted band across the card makes a diff line read as one block.
      const bg = theme.diffSurface(kind);
      return {
        color: theme.color(kind === 'add' ? 'diffAdd' : 'diffDel'),
        ...(bg && { backgroundColor: bg }),
        text: bg ? fit(text).padEnd(inner) : fit(text),
      };
    }
    return { ...(kind === 'dim' && muted), text: fit(text) };
  };
  const { shown, hidden } = approvalRows(view, p.expanded, p.room);
  const key = (k: string, label: string, accent = false) => [
    h(Text, { key: k, bold: true, ...(accent && { color: theme.color('accent') }) }, k),
    h(Text, { key: `${k}-label`, ...muted }, ` ${label}`),
  ];
  const gap = h(Text, null, '   ');
  return h(
    Box,
    { paddingLeft: indent },
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: theme.color('faint'),
        ...(theme.color('faint') ? {} : { borderDimColor: true }),
        paddingX: pad,
        flexGrow: 1,
      },
      h(Text, { bold: true, wrap: 'truncate-end' }, fit(view.title)),
      ...shown.map((r, i) => {
        const { text, ...props } = rowProps(r.kind, r.text);
        return h(Text, { key: i, wrap: 'truncate-end', ...props }, text);
      }),
      hidden
        ? h(
            Text,
            { wrap: 'truncate-end', ...muted },
            fit(
              `${theme.symbols.ellipsis} ${hidden} more ${hidden === 1 ? 'row' : 'rows'}${p.expanded ? '' : ' (v shows all)'}`,
            ),
          )
        : null,
      h(Text, { wrap: 'truncate-end', ...muted }, fit(view.risk)),
      h(
        Text,
        { wrap: 'truncate-end', ...muted },
        fit(`Approval covers exactly this call (${view.shortHash}).`),
      ),
      p.noting
        ? h(
            Text,
            { wrap: 'truncate-end' },
            'Say why below. Enter sends it as a denial, Esc goes back.',
          )
        : h(
            Text,
            { wrap: 'truncate-end' },
            ...key('y', 'approve once', true),
            gap,
            ...key('n', 'deny'),
            gap,
            ...key('e', 'deny and say why'),
            ...(view.more ? [gap, ...key('v', p.expanded ? 'fewer' : 'more')] : []),
          ),
    ),
  );
}

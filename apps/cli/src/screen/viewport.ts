// The scrolling region: one Ink line per row, only the rows in view. No JSX; createElement.
import { Box, Text } from 'ink';
import { createElement as h, memo, type ReactElement } from 'react';
import { spanProps } from '../span-style.ts';
import type { Role, Theme } from '../theme.ts';
import type { Row, RSpan } from './rows.ts';

function textProps(sp: RSpan, theme: Theme) {
  const role: Role | undefined = sp.role;
  return {
    ...spanProps(sp, theme),
    ...(role && theme.props(role)),
    ...(sp.strike && { strikethrough: true }),
    ...(sp.color && { color: sp.color }),
  };
}

const BAR_ROLE = { accent: 'accent', error: 'error', faint: 'faint' } as const;

/** One row, exactly one terminal line tall, `width` columns wide. Memoised: rows are cached, so a keypress redraws none of them. */
export const RowView = memo(function RowView(p: {
  row: Row;
  width: number;
  theme: Theme;
}): ReactElement {
  const { row, theme } = p;
  const body = h(
    Text,
    { wrap: 'truncate-end' },
    row.pad ? ' '.repeat(row.pad) : null,
    ...(row.spans.length
      ? row.spans.map((sp, i) => h(Text, { key: i, ...textProps(sp, theme) }, sp.text))
      : [' ']),
  );
  return h(
    Box,
    { width: p.width, height: 1, flexShrink: 0 },
    row.inset ? h(Box, { width: row.inset, flexShrink: 0 }) : null,
    row.bar ? h(Text, { color: theme.color(BAR_ROLE[row.bar]) }, theme.symbols.bar) : null,
    h(
      Box,
      {
        flexGrow: 1,
        flexShrink: 1,
        ...(row.surface === 'panel' && theme.panel && { backgroundColor: theme.panel }),
      },
      body,
    ),
  );
});

/**
 * The slice of `rows` that fits, from `top`. Short content leaves the rest of the area blank.
 * Memoised, so typing in the prompt (which changes none of its props) does not redraw the session.
 */
export const Viewport = memo(function Viewport(p: {
  rows: Row[];
  top: number;
  height: number;
  width: number;
  theme: Theme;
}): ReactElement {
  const shown = p.rows.slice(p.top, p.top + p.height);
  return h(
    Box,
    {
      flexDirection: 'column',
      height: p.height,
      width: p.width,
      overflow: 'hidden',
      flexShrink: 1,
    },
    ...shown.map((row, i) => h(RowView, { key: p.top + i, row, width: p.width, theme: p.theme })),
  );
});

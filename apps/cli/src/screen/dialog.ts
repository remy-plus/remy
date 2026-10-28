// A centered dialog: an absolutely positioned panel over the screen with a title row.
import { Box, Text } from 'ink';
import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { Theme } from '../theme.ts';

export type DialogSizeName = 'small' | 'medium' | 'large';

const WIDTHS: Record<DialogSizeName, number> = { small: 60, medium: 88, large: 116 };
/** Rows the frame itself takes: padding 2, title 1, gap 1, search 1, gap 1, bottom margin 1. */
const CHROME = 7;

export interface DialogGeometry {
  /** Outer width including padding. */
  width: number;
  /** Inner width for content (outer minus horizontal padding). */
  inner: number;
  top: number;
  left: number;
  /** Rows available to a list inside the frame. */
  listRows: number;
}

export function dialogSize(columns: number, rows: number, size: DialogSizeName): DialogGeometry {
  const width = Math.max(10, Math.min(WIDTHS[size], columns - 2));
  const top = Math.floor(rows / 4);
  return {
    width,
    inner: width - 4,
    top,
    left: Math.max(0, Math.floor((columns - width) / 2)),
    listRows: Math.max(1, Math.min(16, rows - top - CHROME)),
  };
}

export function Dialog(p: {
  title: string;
  theme: Theme;
  columns: number;
  rows: number;
  size?: DialogSizeName;
  /** Panel background; defaults to the theme's quiet surface. */
  background?: string;
  children?: ReactNode;
}): ReactElement {
  const g = dialogSize(p.columns, p.rows, p.size ?? 'medium');
  const bg = p.background ?? p.theme.surface;
  return h(
    Box,
    {
      position: 'absolute',
      top: g.top,
      left: g.left,
      width: g.width,
      flexDirection: 'column',
      paddingX: 2,
      paddingY: 1,
      ...(bg && { backgroundColor: bg }),
    },
    h(
      Box,
      { justifyContent: 'space-between' },
      h(Text, { bold: true }, p.title),
      h(Text, p.theme.props('muted'), 'esc'),
    ),
    h(Box, { height: 1 }),
    p.children,
  );
}

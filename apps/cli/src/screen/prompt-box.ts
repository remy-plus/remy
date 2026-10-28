// The prompt in the full-screen layout: a left bar and a filled panel, text that grows from one
// row to a limit, and a meta row (model, provider) inside it.
import { Box, type DOMElement, Text, useBoxMetrics, useCursor, useStdout } from 'ink';
import { createElement as h, type ReactElement, type ReactNode, useEffect, useRef } from 'react';
import type { InputState } from '../input.ts';
import { strWidth } from '../markdown.ts';
import type { Theme } from '../theme.ts';
import { layoutPrompt } from './prompt-layout.ts';

/** Columns of padding between the bar and the text, and the text and the right edge. */
const PAD = 2;

export interface PromptBoxProps {
  value: InputState;
  theme: Theme;
  /** Columns the whole box takes, bar included. */
  width: number;
  maxRows: number;
  /** Idle and taking input: the bar shows the accent. */
  focused: boolean;
  placeholder: string;
  model?: string;
  provider?: string;
  /** Reverse history search under way (Ctrl+R): its query shows in the meta row. */
  search?: string;
}

/** Rows the box takes: a padding row, the text, a gap, and the meta row. */
export function promptBoxRows(value: InputState, width: number, maxRows: number): number {
  const inner = Math.max(4, width - 1 - PAD * 2);
  return 1 + layoutPrompt(value.text, value.cursor, inner, maxRows).rows.length + 1 + 1;
}

/** Cells from the screen's top-left to an element, summed from the layout of it and its parents. */
function screenOrigin(el: DOMElement | null): { x: number; y: number } | undefined {
  let x = 0;
  let y = 0;
  for (let n: DOMElement | undefined = el ?? undefined; n; n = n.parentNode) {
    if (!n.yogaNode) return undefined;
    x += n.yogaNode.getComputedLeft();
    y += n.yogaNode.getComputedTop();
  }
  return { x, y };
}

function BoxRow(p: { theme: Theme; width: number; focused: boolean; children?: ReactNode }) {
  const { theme } = p;
  return h(
    Box,
    { width: p.width, height: 1, flexShrink: 0 },
    h(Text, { color: theme.bar(p.focused) }, theme.symbols.bar),
    h(
      Box,
      { flexGrow: 1, flexShrink: 1, ...(theme.element && { backgroundColor: theme.element }) },
      h(Text, { wrap: 'truncate-end' }, ' '.repeat(PAD), p.children ?? ' '),
    ),
  );
}

export function PromptBox(p: PromptBoxProps): ReactElement {
  const { theme, value } = p;
  const inner = Math.max(4, p.width - 1 - PAD * 2);
  const lay = layoutPrompt(value.text, value.cursor, inner, p.maxRows);
  // On a terminal the real cursor sits in the prompt; the drawn mark is for output that is not one.
  const real = Boolean((useStdout().stdout as { isTTY?: boolean } | undefined)?.isTTY);
  const ref = useRef<DOMElement>(null);
  const { setCursorPosition } = useCursor();
  const metrics = useBoxMetrics(ref);
  const col = value.text ? lay.cursorCol : 0;
  const row = value.text ? lay.cursorRow : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: metrics re-run this when the box moves
  useEffect(() => {
    const at = real && p.focused ? screenOrigin(ref.current) : undefined;
    setCursorPosition(at && { x: at.x + 1 + PAD + col, y: at.y + 1 + row });
    return () => setCursorPosition(undefined);
  }, [real, p.focused, col, row, metrics.left, metrics.top, metrics.height, setCursorPosition]);
  const muted = theme.props('muted');
  const cursor = (ch: string) =>
    real
      ? h(Text, null, ch === theme.symbols.cursor ? '' : ch)
      : h(Text, { color: theme.color('accent'), inverse: theme.level === 'none' }, ch);
  const rows = lay.rows.map((r, i) => {
    if (!value.text && i === 0)
      return h(
        BoxRow,
        { key: i, theme, width: p.width, focused: p.focused },
        cursor(theme.symbols.cursor),
        h(Text, muted, p.placeholder),
      );
    if (i !== lay.cursorRow || !p.focused)
      return h(BoxRow, { key: i, theme, width: p.width, focused: p.focused }, r.text || ' ');
    // Split at the cursor in the row's own text; the cursor sits on the next character.
    const chars = [...r.text];
    let w = 0;
    let at = 0;
    while (at < chars.length && w < lay.cursorCol) w += strWidth(chars[at++] as string);
    const before = chars.slice(0, at).join('');
    const on = chars[at] ?? theme.symbols.cursor;
    return h(
      BoxRow,
      { key: i, theme, width: p.width, focused: p.focused },
      before,
      cursor(on),
      chars.slice(at + 1).join(''),
    );
  });
  const meta = [p.model ?? 'not connected', p.provider].filter(Boolean);
  return h(
    Box,
    { ref, flexDirection: 'column', width: p.width, flexShrink: 0 },
    h(BoxRow, { theme, width: p.width, focused: p.focused }),
    ...rows,
    h(BoxRow, { theme, width: p.width, focused: p.focused }),
    h(
      BoxRow,
      { theme, width: p.width, focused: p.focused },
      p.search === undefined ? h(Text, null, meta[0]) : null,
      p.search === undefined && meta[1] ? h(Text, muted, ` ${theme.symbols.dot} ${meta[1]}`) : null,
      p.search !== undefined
        ? h(Text, muted, `search: ${p.search}${theme.symbols.cursor}  enter accept · esc cancel`)
        : null,
    ),
  );
}

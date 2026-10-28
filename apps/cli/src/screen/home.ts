// The home screen: the wordmark, the prompt and one tip, centred in the full terminal.
import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { Theme } from '../theme.ts';
import { WORDMARK, WORDMARK_WIDTH } from '../wordmark.ts';

export interface HomeProps {
  theme: Theme;
  columns: number;
  rows: number;
  /** The prompt box, drawn by the caller. */
  prompt: ReactNode;
  version: string;
  workspace: string;
  tip?: string;
  notice?: string;
  /** `Good evening, Sam.` under the wordmark, once the user has a profile. */
  greeting?: string;
}

/** Below this many rows the wordmark becomes one line. */
export const FULL_MIN_ROWS = 18;
/** Below this many rows the tip is dropped. */
export const TIP_MIN_ROWS = 24;
const PROMPT_MAX = 75;

/** `/Users/me/work` as `~/work`, cut from the left to fit `max` columns. */
export function shortenPath(path: string, max: number, home: string = homedir()): string {
  let p = path;
  if (home && (p === home || p.startsWith(`${home}/`))) p = `~${p.slice(home.length)}`;
  if (max <= 1) return p.slice(0, Math.max(0, max));
  return p.length > max ? `…${p.slice(p.length - max + 1)}` : p;
}

export function Home(p: HomeProps): ReactElement {
  const { theme, columns, rows } = p;
  const muted = theme.props('muted');
  const full = rows >= FULL_MIN_ROWS && columns >= WORDMARK_WIDTH + 4;
  const showTip = Boolean(p.tip) && rows >= TIP_MIN_ROWS;
  const promptWidth = Math.max(10, Math.min(PROMPT_MAX, columns - 4));
  const version = `v${p.version.replace(/^v/, '')}`;
  const workspace = shortenPath(
    p.workspace,
    Math.max(8, Math.min(columns - version.length - 6, Math.floor(columns * 0.4))),
  );

  const mark = full
    ? h(
        Box,
        { flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
        ...WORDMARK.map((line, i) => {
          const color = theme.ramp(i, WORDMARK.length);
          return h(Text, { key: i, ...(color ? { color } : {}) }, line.padEnd(WORDMARK_WIDTH));
        }),
      )
    : h(Text, { bold: true }, 'REMY');

  return h(
    Box,
    { flexDirection: 'column', width: columns, height: rows, paddingX: 2, alignItems: 'center' },
    h(Box, { flexGrow: 1, flexShrink: 1 }),
    mark,
    h(Box, { height: 1, flexShrink: 0 }),
    p.greeting
      ? h(
          Box,
          { flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: promptWidth },
          h(Text, { wrap: 'truncate-end' }, p.greeting),
          h(Box, { height: 1 }),
        )
      : null,
    h(Box, { width: promptWidth, flexShrink: 0, flexDirection: 'column' }, p.prompt),
    h(
      Box,
      { width: promptWidth, flexShrink: 0, justifyContent: 'flex-end' },
      h(Text, null, 'ctrl+p', h(Text, { ...muted }, ' commands')),
    ),
    p.notice
      ? h(
          Box,
          { width: promptWidth, marginTop: 1, flexShrink: 0 },
          h(Text, { ...muted, wrap: 'truncate-end' }, p.notice),
        )
      : null,
    showTip
      ? h(
          Box,
          { width: promptWidth, marginTop: 3, flexShrink: 0 },
          h(Text, { ...theme.props('accent') }, `${theme.symbols.done} `),
          h(Text, { ...muted, wrap: 'truncate-end' }, `Tip ${p.tip}`),
        )
      : null,
    // Biases the block slightly above the middle.
    h(Box, { flexGrow: 1.5, flexShrink: 1 }),
    h(
      Box,
      { width: columns - 4, flexShrink: 0, justifyContent: 'space-between' },
      h(Text, { ...muted, wrap: 'truncate-start' }, workspace),
      h(Text, { ...muted }, version),
    ),
  );
}

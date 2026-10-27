// One place for the look of the terminal: palette, color levels, symbols, spacing.
// Brand rules are in branding/README.md. Signal is the only accent: cursor and done states.

export const PALETTE = {
  ink: '#0F0F10',
  paper: '#EDEBE6',
  stone: '#8C8A85',
  signal: '#A8C49A',
} as const;

/** `none` prints no color codes at all; `basic` uses the 16 terminal colors. */
export type ColorLevel = 'none' | 'basic' | 'truecolor';

export type Role = 'text' | 'muted' | 'accent' | 'error' | 'diffAdd' | 'diffDel';

/** Functional colours outside the brand palette: a soft clay for errors and removed lines. */
const CLAY = '#D08A78';

export const SYMBOLS = {
  prompt: '›',
  cursor: '▌',
  bullet: '•',
  bulletSub: '◦',
  gutter: '│',
  quote: '▎',
  rule: '─',
  ellipsis: '…',
  dot: '·',
  ok: '✓',
  failed: '✗',
  denied: '–',
  waiting: '?',
  running: '·',
  todo: '○',
  doing: '◐',
  done: '●',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

/**
 * Spaces and rows. Everything is a multiple of one column; the transcript has one left margin
 * (`indent`), a two-column lead for glyphs (`lead`) and one blank row between turns (`turn`).
 */
export const SPACE = {
  indent: 2,
  gap: 1,
  lead: 2,
  turn: 1,
  /** Columns between a card's border and its text. */
  pad: 1,
  /** Tool verbs are padded to this width so targets line up. */
  verb: 7,
  /** Longest horizontal rule inside a reply. */
  rule: 40,
  /** Columns between table columns. */
  column: 3,
} as const;

/** Milliseconds per spinner frame: calm, not busy. */
export const SPINNER_MS = 100;

export type Background = 'dark' | 'light';

export interface Theme {
  level: ColorLevel;
  background: Background;
  /** The same theme tuned for a light or dark terminal background. */
  withBackground(bg: Background): Theme;
  /** A color for Ink's `color` prop, or undefined to leave the terminal default. */
  color(role: Role): string | undefined;
  /** Wordmark row color: a soft brightness ramp from the top row to the bottom one. */
  ramp(row: number, rows: number): string | undefined;
  symbols: typeof SYMBOLS;
  space: typeof SPACE;
}

const unset = (v: string | undefined) => v === undefined || v === '' || v === '0' || v === 'false';

export function detectColor(env: Record<string, string | undefined>, isTTY: boolean): ColorLevel {
  if (!unset(env.NO_COLOR) || env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') return 'none';
  if (env.TERM === 'dumb') return 'none';
  if (!isTTY && unset(env.FORCE_COLOR)) return 'none';
  if (env.FORCE_COLOR === '3' || /^(truecolor|24bit)$/i.test(env.COLORTERM ?? ''))
    return 'truecolor';
  return 'basic';
}

const rgb = (h: string): [number, number, number] => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  const c = (i: number) => Math.round((x[i] as number) + ((y[i] as number) - (x[i] as number)) * t);
  return `#${[c(0), c(1), c(2)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

// Body text keeps the terminal's own foreground so it reads on light and dark backgrounds.
// The wordmark ramps from a dimmed paper up to paper.
const RAMP_TOP = '#B9B6AF';

const BASIC: Record<Exclude<Role, 'text'>, string> = {
  muted: 'gray',
  accent: 'green',
  diffAdd: 'green',
  diffDel: 'red',
  error: 'red',
};
const TRUE: Record<Background, Record<Exclude<Role, 'text'>, string>> = {
  dark: {
    muted: PALETTE.stone,
    accent: PALETTE.signal,
    diffAdd: PALETTE.signal,
    diffDel: CLAY,
    error: CLAY,
  },
  // Darker shades of the same hues, so they keep their contrast on paper.
  light: {
    muted: '#6B6964',
    accent: '#4A7A3C',
    diffAdd: '#4A7A3C',
    diffDel: '#A8503E',
    error: '#A8503E',
  },
};
// On a light background the wordmark ramps from a lifted ink down to ink.
const RAMP_TOP_LIGHT = '#5A5854';
const RAMP_END_LIGHT = PALETTE.ink;

export function createTheme(level: ColorLevel, background: Background = 'dark'): Theme {
  const truecolor = TRUE[background];
  const [from, to] =
    background === 'light' ? [RAMP_TOP_LIGHT, RAMP_END_LIGHT] : [RAMP_TOP, PALETTE.paper];
  return {
    level,
    background,
    withBackground: (bg) => createTheme(level, bg),
    color: (role) => {
      if (level === 'none' || role === 'text') return undefined;
      if (level === 'basic') return BASIC[role];
      return truecolor[role];
    },
    ramp: (row, rows) =>
      level === 'truecolor' ? mix(from, to, rows > 1 ? row / (rows - 1) : 1) : undefined,
    symbols: SYMBOLS,
    space: SPACE,
  };
}

/** ANSI escape for a role, for the plain-text output. Empty when color is off. */
export function ansi(level: ColorLevel, role: Role | 'bold'): string {
  if (level === 'none') return '';
  if (role === 'bold') return '\x1b[1m';
  if (role === 'text') return '';
  if (level === 'basic')
    return `\x1b[${role === 'muted' ? 90 : role === 'error' || role === 'diffDel' ? 31 : 32}m`;
  const [r, g, b] = rgb(TRUE.dark[role]);
  return `\x1b[38;2;${r};${g};${b}m`;
}

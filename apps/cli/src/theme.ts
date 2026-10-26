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

/** Spaces and rows. */
export const SPACE = { indent: 2, gap: 1 } as const;

export interface Theme {
  level: ColorLevel;
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
const TRUE: Record<Exclude<Role, 'text'>, string> = {
  muted: PALETTE.stone,
  accent: PALETTE.signal,
  diffAdd: PALETTE.signal,
  diffDel: CLAY,
  error: CLAY,
};

export function createTheme(level: ColorLevel): Theme {
  return {
    level,
    color: (role) => {
      if (level === 'none' || role === 'text') return undefined;
      if (level === 'basic') return BASIC[role];
      return TRUE[role];
    },
    ramp: (row, rows) =>
      level === 'truecolor'
        ? mix(RAMP_TOP, PALETTE.paper, rows > 1 ? row / (rows - 1) : 1)
        : undefined,
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
  const [r, g, b] = rgb(TRUE[role]);
  return `\x1b[38;2;${r};${g};${b}m`;
}

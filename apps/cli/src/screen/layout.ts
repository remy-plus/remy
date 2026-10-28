// Sizes for the full-screen layout, from the terminal's columns and rows. Pure.

/** Columns of side padding on each side of the main column. */
export const GUTTER = 2;
/** The sidebar shows inline above this many columns. */
export const SIDEBAR_MIN_COLUMNS = 120;
export const SIDEBAR_WIDTH = 42;
/** Widest the prompt on the home screen goes. */
export const HOME_PROMPT_MAX = 75;
/** Rows the screen keeps for everything but the prompt text: viewport, meta, status. */
const RESERVED_ROWS = 8;

export interface Layout {
  columns: number;
  rows: number;
  sidebar: 'inline' | 'none';
  sidebarWidth: number;
  /** Columns for messages: the screen less the gutters and the sidebar. */
  contentWidth: number;
  /** Most rows the prompt text grows to. */
  promptMaxRows: number;
  homePromptWidth: number;
}

export function computeLayout(
  columns: number,
  rows: number,
  opts: { sidebar?: boolean } = {},
): Layout {
  const cols = Math.max(20, Math.floor(columns));
  const r = Math.max(1, Math.floor(rows));
  const inline = opts.sidebar !== false && cols > SIDEBAR_MIN_COLUMNS;
  const sidebarWidth = inline ? SIDEBAR_WIDTH : 0;
  return {
    columns: cols,
    rows: r,
    sidebar: inline ? 'inline' : 'none',
    sidebarWidth,
    contentWidth: Math.max(10, cols - GUTTER * 2 - sidebarWidth),
    // max(6, rows / 3), but never so tall that the viewport is gone.
    promptMaxRows: Math.max(1, Math.min(Math.max(6, Math.floor(r / 3)), r - RESERVED_ROWS)),
    homePromptWidth: Math.max(10, Math.min(HOME_PROMPT_MAX, cols - GUTTER * 2)),
  };
}

// The prompt text wrapped to its box: visual rows, the cursor's place among them, and the
// window of rows to show when the text is taller than the box may grow. Pure.
import { strWidth } from '../markdown.ts';

export interface PromptRow {
  /** Index into the text where the row starts. */
  start: number;
  text: string;
}

export interface PromptLayout {
  /** Rows to show, at most `maxRows`. */
  rows: PromptRow[];
  /** Number of wrapped rows in the whole text. */
  total: number;
  /** Index in `rows` of the cursor row, and its column in cells. */
  cursorRow: number;
  cursorCol: number;
}

/** Breaks one logical line into rows of at most `width` cells, at a space when there is one. */
function wrapLine(line: string, base: number, width: number): PromptRow[] {
  const out: PromptRow[] = [];
  let start = 0;
  while (start < line.length) {
    let w = 0;
    let end = start;
    let lastSpace = -1;
    while (end < line.length) {
      const ch = String.fromCodePoint(line.codePointAt(end) as number);
      const cw = strWidth(ch);
      if (w + cw > width && ch !== ' ') break;
      w += cw;
      end += ch.length;
      if (ch === ' ') lastSpace = end;
    }
    if (end < line.length) {
      if (lastSpace > start) end = lastSpace;
      else if (end === start)
        end = start + String.fromCodePoint(line.codePointAt(start) as number).length;
    }
    out.push({ start: base + start, text: line.slice(start, end) });
    start = end;
  }
  return out.length ? out : [{ start: base, text: '' }];
}

export function layoutPrompt(
  text: string,
  cursor: number,
  width: number,
  maxRows: number,
): PromptLayout {
  const w = Math.max(4, width);
  const all: PromptRow[] = [];
  let base = 0;
  for (const line of text.split('\n')) {
    all.push(...wrapLine(line, base, w));
    base += line.length + 1;
  }
  let at = 0;
  all.forEach((r, i) => {
    if (r.start <= cursor) at = i;
  });
  const max = Math.max(1, maxRows);
  const from = Math.max(0, Math.min(at - max + 1, all.length - max));
  const rows = all.slice(from, from + max);
  const row = all[at] as PromptRow;
  return {
    rows,
    total: all.length,
    cursorRow: at - from,
    cursorCol: strWidth(row.text.slice(0, Math.max(0, cursor - row.start))),
  };
}

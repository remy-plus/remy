// Light markdown for the chat: headings, lists, **bold**, `code`, fenced blocks. It returns
// lines of styled spans already wrapped to a width, so the screen knows exactly how many rows
// a block takes and can keep the live area short. Pure; no Ink in here.

import { SPACE, SYMBOLS } from './theme.ts';

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  dim?: boolean;
  /** Structure (gutters, rules, quote bars): quieter than `dim`. */
  faint?: boolean;
}
export type MdLine = Span[];

/** Terminal columns one character takes: 0 for combining marks, 2 for wide and emoji. */
function cellWidth(cp: number): number {
  if (cp === 0 || (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f))
    return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += cellWidth(ch.codePointAt(0) as number);
  return w;
}

export const lineWidth = (l: MdLine) => l.reduce((n, s) => n + strWidth(s.text), 0);

/** Cuts a string to at most `width` columns. */
export function clip(s: string, width: number): string {
  if (strWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = cellWidth(ch.codePointAt(0) as number);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Splits a long word into chunks that each fit `width`. */
function hardSplit(word: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of word) {
    const cw = cellWidth(ch.codePointAt(0) as number);
    if (w + cw > width && cur) {
      out.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur) out.push(cur);
  return out;
}

const INLINE =
  /\*\*(.+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(?<![*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![*\w])/g;

/** Inline styles. An unclosed marker (a half-streamed `**`) stays literal text. */
export function inline(src: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index as number;
    if (at > last) out.push({ text: src.slice(last, at) });
    if (m[1] !== undefined) for (const s of inline(m[1])) out.push({ ...s, bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], code: true });
    else if (m[3] !== undefined) {
      out.push({ text: m[3] }, { text: ` (${m[4]})`, dim: true });
    } else out.push({ text: m[5] as string, italic: true });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

const style = (s: Span): Omit<Span, 'text'> => ({
  ...(s.bold && { bold: true }),
  ...(s.italic && { italic: true }),
  ...(s.code && { code: true }),
  ...(s.dim && { dim: true }),
  ...(s.faint && { faint: true }),
});

/**
 * Greedy word wrap. `first` and `rest` are the indents of the first and later lines (plain
 * spaces, or a marker such as "- " on the first), and count against `width`.
 */
export function wrapSpans(spans: Span[], width: number, first = '', rest = first): MdLine[] {
  const lines: MdLine[] = [];
  let cur: MdLine = first ? [{ text: first }] : [];
  let w = strWidth(first);
  let indent = first;
  let has = false; // words on the current line
  let pendingSpace = false;
  const room = (ind: string) => Math.max(4, width - strWidth(ind));

  const newLine = () => {
    lines.push(cur);
    indent = rest;
    cur = rest ? [{ text: rest }] : [];
    w = strWidth(rest);
    has = false;
    pendingSpace = false;
  };

  for (const sp of spans) {
    for (const tok of sp.text.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) {
        pendingSpace = has;
        continue;
      }
      const tw = strWidth(tok);
      const need = (pendingSpace ? 1 : 0) + tw;
      if (has && w + need > width) newLine();
      if (tw > room(indent)) {
        if (has) newLine();
        const parts = hardSplit(tok, room(indent));
        parts.forEach((p, i) => {
          if (i > 0) newLine();
          cur.push({ text: p, ...style(sp) });
          w += strWidth(p);
          has = true;
        });
        continue;
      }
      if (pendingSpace && has) {
        cur.push({ text: ' ' });
        w += 1;
      }
      cur.push({ text: tok, ...style(sp) });
      w += tw;
      has = true;
      pendingSpace = false;
    }
  }
  if (has || lines.length === 0) lines.push(cur);
  return lines;
}

const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** `---|---` under a header row, with or without the outer pipes. */
const isTableRule = (row: string) =>
  row.includes('|') && row.includes('-') && TABLE_RULE.test(row.trim());
const MIN_COLUMN = 6;

const plain = (spans: Span[]) => spans.map((s) => s.text).join('');
const cellsOf = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

/** A pipe table as aligned rows: bold header, a faint rule, cells clipped to fit `width`. */
function renderTable(rows: string[], width: number): MdLine[] {
  const [head, , ...body] = rows.map(cellsOf);
  const cols = (head as string[]).length;
  const grid = [
    head as string[],
    ...body.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')),
  ];
  const parsed = grid.map((r) => r.map((c) => inline(c)));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...parsed.map((r) => strWidth(plain(r[c] as Span[])))),
  );
  const gaps = SPACE.column * (cols - 1);
  while (widths.reduce((a, b) => a + b, 0) + gaps > width) {
    const widest = widths.indexOf(Math.max(...widths));
    if ((widths[widest] as number) <= MIN_COLUMN) break;
    widths[widest] = (widths[widest] as number) - 1;
  }
  const gap = ' '.repeat(SPACE.column);
  const line = (cells: Span[][], header: boolean): MdLine => {
    const out: MdLine = [];
    cells.forEach((spans, c) => {
      const room = widths[c] as number;
      const text = plain(spans);
      const fits = strWidth(text) <= room;
      const shown: Span[] = fits ? spans : [{ text: clip(text, room) }];
      for (const sp of shown) out.push(header ? { ...sp, bold: true } : sp);
      const used = fits ? strWidth(text) : Math.min(room, strWidth(clip(text, room)));
      if (c < cols - 1) out.push({ text: ' '.repeat(room - used) + gap });
    });
    return out;
  };
  const rule: MdLine = [
    {
      text: widths.map((w) => SYMBOLS.rule.repeat(w)).join(SYMBOLS.rule.repeat(SPACE.column)),
      faint: true,
    },
  ];
  return [line(parsed[0] as Span[][], true), rule, ...parsed.slice(1).map((r) => line(r, false))];
}

/** Dim a list marker so the text carries the line. */
function dimMarker(lines: MdLine[], pad: string, marker: string): MdLine[] {
  const first = lines[0];
  if (first?.[0]?.text === pad + marker)
    first.splice(0, 1, ...(pad ? [{ text: pad }] : []), { text: marker, dim: true });
  return lines;
}

export function renderMarkdown(src: string, width: number): MdLine[] {
  const w = Math.max(12, width);
  const out: MdLine[] = [];
  let fenced = false;
  let blank = true;
  const gap = () => {
    if (!blank) out.push([]);
    blank = true;
  };
  const rows = src.replace(/\r/g, '').split('\n');

  for (let n = 0; n < rows.length; n++) {
    const line = (rows[n] as string).replace(/\s+$/, '');
    const fence = FENCE.exec(line);
    if (fence) {
      fenced = !fenced;
      if (fenced) {
        gap();
        if (fence[2]) out.push([{ text: `  ${fence[2]}`, dim: true }]);
        blank = false;
      } else blank = false;
      if (!fenced) gap();
      continue;
    }
    if (fenced) {
      const parts = line ? hardSplit(line.replace(/\t/g, '  '), w - 4) : [''];
      for (const p of parts) out.push([{ text: `  ${SYMBOLS.gutter} `, faint: true }, { text: p }]);
      blank = false;
      continue;
    }
    if (!line.trim()) {
      gap();
      continue;
    }
    if (line.includes('|') && isTableRule(rows[n + 1] ?? '')) {
      const table = [line, rows[n + 1] as string];
      let k = n + 2;
      while (k < rows.length && (rows[k] as string).includes('|')) table.push(rows[k++] as string);
      gap();
      out.push(...renderTable(table, w));
      blank = false;
      n = k - 1;
      continue;
    }
    const head = HEADING.exec(line);
    if (head) {
      gap();
      const level = (head[1] as string).length;
      const spans = inline(head[2] as string).map((s) => ({
        ...s,
        bold: true,
        ...(level > 2 && { dim: true }),
      }));
      const wrapped = wrapSpans(spans, w);
      out.push(...wrapped);
      if (level === 1)
        out.push([
          {
            text: SYMBOLS.rule.repeat(Math.min(SPACE.rule, Math.max(...wrapped.map(lineWidth)))),
            faint: true,
          },
        ]);
      blank = false;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push([{ text: SYMBOLS.rule.repeat(Math.min(w, SPACE.rule)), faint: true }]);
      blank = false;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const bar = `${SYMBOLS.quote} `;
      for (const l of wrapSpans(
        inline(quote[1] as string).map((s) => ({ ...s, dim: true })),
        w - 2,
      ))
        out.push([{ text: bar, faint: true }, ...l]);
      blank = false;
      continue;
    }
    const li = BULLET.exec(line);
    if (li) {
      const depth = Math.floor((li[1] as string).length / 2);
      const pad = ' '.repeat(depth * 2);
      const ordered = /\d/.test(li[2] as string);
      const marker = ordered ? `${li[2]} ` : `${depth ? SYMBOLS.bulletSub : SYMBOLS.bullet} `;
      out.push(
        ...dimMarker(
          wrapSpans(inline(li[3] as string), w, pad + marker, pad + ' '.repeat(marker.length)),
          pad,
          marker,
        ),
      );
      blank = false;
      continue;
    }
    out.push(...wrapSpans(inline(line), w));
    blank = false;
  }
  while (out.length && out[out.length - 1]?.length === 0) out.pop();
  return out;
}

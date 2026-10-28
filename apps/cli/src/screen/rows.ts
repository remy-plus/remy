// Transcript items as styled rows at a fixed width, for the full-screen viewport. The
// viewport needs exact row counts to scroll, so Remy wraps text itself instead of asking Ink.
// Pure: no Ink here. Rows for a finished item are memoised per item, width and theme.
import type { Item } from '../chat.ts';
import { clip, renderMarkdown, type Span, strWidth, wrapPlain } from '../markdown.ts';
import type { Role, Theme } from '../theme.ts';
import { type ToolLine, toolBits } from '../transcript.ts';

/** A span with a colour role and, for a denied call, a line through it. */
export interface RSpan extends Span {
  role?: Role;
  strike?: boolean;
  /** An exact colour over the role's, for a fade. */
  color?: string;
}

export interface Row {
  spans: RSpan[];
  /** Columns before the bar or the surface. */
  inset: number;
  /** A left bar after the inset, in this colour. */
  bar?: 'accent' | 'error' | 'faint';
  /** A background from the bar to the right edge. */
  surface?: 'panel';
  /** Columns between the bar (or the inset) and the text. */
  pad: number;
}

/** Message text starts three columns in, under the tool glyph's left edge. */
export const TEXT_INDENT = 3;
/** Lines of a tool body shown before "N more lines". */
export const BODY_LINES = 10;

export const BLANK: Row = { spans: [], inset: 0, pad: 0 };

const row = (spans: RSpan[], o: Partial<Omit<Row, 'spans'>> = {}): Row => ({
  spans,
  inset: o.inset ?? TEXT_INDENT,
  pad: o.pad ?? 0,
  ...(o.bar && { bar: o.bar }),
  ...(o.surface && { surface: o.surface }),
});

/** Plain text of a row as it would sit on screen, for tests and search. */
export function rowText(r: Row): string {
  const lead = ' '.repeat(r.inset) + (r.bar ? '┃' : '') + ' '.repeat(r.pad);
  return (lead + r.spans.map((s) => s.text).join('')).trimEnd();
}

/** Cuts spans to `width` columns, ending in an ellipsis. */
export function fitSpans(spans: RSpan[], width: number): RSpan[] {
  let used = 0;
  const out: RSpan[] = [];
  for (const sp of spans) {
    const w = strWidth(sp.text);
    if (used + w <= width) {
      out.push(sp);
      used += w;
      continue;
    }
    const left = width - used;
    if (left > 0) out.push({ ...sp, text: clip(sp.text, left) });
    break;
  }
  return out;
}

const withRole =
  (role: Role | undefined, strike = false) =>
  (sp: Span): RSpan => ({
    ...sp,
    ...(role && { role }),
    ...(strike && { strike }),
  });

/** Markdown at a width, as rows at the text indent. */
export function markdownRows(text: string, width: number, role?: Role): Row[] {
  return renderMarkdown(text, Math.max(12, width - TEXT_INDENT)).map((l) =>
    row(l.map(withRole(role))),
  );
}

/** The glyph in front of a tool row, by what the tool does. */
const TOOL_GLYPH: Record<string, string> = {
  run_command: '$',
  write_file: '←',
  edit_file: '←',
  move_file: '←',
  delete_file: '←',
  make_dir: '←',
  read_file: '→',
  list_files: '✱',
  fetch_url: '%',
  web_search: '◈',
  calculate: '=',
};
const BLOCK_TOOLS = new Set(['edit_file', 'run_command']);

/** "... 5 more lines" from the recorded detail, made into the collapsed form with the key. */
const MORE = /^([+-] )?\.\.\. (\d+) more lines$/;

/** Rows of a tool's output or diff in a panel block, collapsed to `BODY_LINES`. */
function bodyRows(line: ToolLine, width: number): Row[] {
  const detail = line.detail ?? [];
  const lead: string[] = line.tool === 'run_command' ? [`$ ${line.target}`] : [];
  const all = [...lead, ...detail];
  const kept = all.slice(0, BODY_LINES);
  const extra = all.length - kept.length;
  const inner = Math.max(8, width - TEXT_INDENT - 4);
  const mk = (spans: RSpan[]) => row(spans, { surface: 'panel', pad: 2 });
  const out: Row[] = [mk([])];
  for (const l of kept) {
    const m = MORE.exec(l);
    if (m) {
      out.push(mk([{ text: `… ${m[2]} more lines (ctrl+o)`, role: 'muted' }]));
      continue;
    }
    const role: Role | undefined = l.startsWith('+ ')
      ? 'diffAdd'
      : l.startsWith('- ')
        ? 'diffDel'
        : l === lead[0]
          ? undefined
          : 'muted';
    out.push(mk([{ text: clip(l, inner), ...(role && { role }) }]));
  }
  if (extra > 0) out.push(mk([{ text: `… ${extra} more lines (ctrl+o)`, role: 'muted' }]));
  out.push(mk([]));
  return out;
}

/** One tool call: a single line, plus a panel body for edits and commands that have one. */
export function toolRows(
  line: ToolLine,
  width: number,
  theme: Theme,
  spinner?: string,
  now?: number,
) {
  const glyph = line.state === 'running' && spinner ? spinner : (TOOL_GLYPH[line.tool] ?? '⚙');
  const mark = line.state === 'waiting_approval' ? theme.symbols.waiting : glyph;
  const role: Role | undefined =
    line.state === 'failed'
      ? 'error'
      : line.state === 'ok' || line.state === 'denied'
        ? 'muted'
        : undefined;
  const strike = line.state === 'denied';
  const text = line.tool === 'run_command' ? line.target : `${line.verb} ${line.target}`.trimEnd();
  // A call that took under a second needs no time beside it.
  const quick = line.ms !== undefined && line.ms < 1000;
  const bits = toolBits(quick ? { ...line, ms: undefined } : line, now);
  const spans: RSpan[] = [
    { text: `${mark} `, role: role ?? 'muted' },
    { text, ...(role && { role }), ...(strike && { strike }) },
    ...(bits.length
      ? [{ text: `  ${bits.join(` ${theme.symbols.dot} `)}`, role: role ?? ('muted' as Role) }]
      : []),
  ];
  const head = row(fitSpans(spans, width - TEXT_INDENT));
  if (line.state !== 'ok' || !BLOCK_TOOLS.has(line.tool) || !line.detail?.length) return [head];
  return [head, ...bodyRows(line, width)];
}

/** A user message: a bar and a panel, padded a row above and below. */
function userRows(text: string, width: number): Row[] {
  const inner = Math.max(8, width - 1 - 4);
  const mk = (t: string) =>
    row(t ? [{ text: t }] : [], { inset: 0, bar: 'accent', surface: 'panel', pad: 2 });
  return [mk(''), ...text.split('\n').flatMap((l) => wrapPlain(l, inner).map(mk)), mk('')];
}

function errorRows(text: string, width: number): Row[] {
  const inner = Math.max(8, width - 1 - 4);
  const mk = (t: string) =>
    row(t ? [{ text: t, role: 'muted' }] : [], {
      inset: 0,
      bar: 'error',
      surface: 'panel',
      pad: 2,
    });
  return [mk(''), ...text.split('\n').flatMap((l) => wrapPlain(l, inner).map(mk)), mk('')];
}

/** The muted line under a turn's last item: model, time taken and, when cut short, "stopped". */
function withFooter(
  body: Row[],
  item: { model?: string; ms?: number; stopped?: boolean },
  theme: Theme,
): Row[] {
  if (!item.ms) return body;
  const parts = [
    item.model,
    `${Math.max(1, Math.round(item.ms / 1000))}s`,
    item.stopped && 'stopped',
  ];
  const who = parts.filter(Boolean);
  return [
    ...body,
    BLANK,
    row([{ text: `▣ ${who.join(` ${theme.symbols.dot} `)}`, role: 'muted' }]),
  ];
}

/** Rows for one finished item, without the blank row that separates it from the one above. */
export function itemRows(item: Item, width: number, theme: Theme): Row[] {
  switch (item.kind) {
    case 'user':
      return userRows(item.text, width);
    case 'reply':
      return withFooter(markdownRows(item.text, width), item, theme);
    case 'text':
      return markdownRows(item.text, width);
    case 'question':
      return markdownRows(`${theme.symbols.waiting} ${item.text}`, width);
    case 'note':
      return withFooter(markdownRows(item.text, width, 'muted'), item, theme);
    case 'error':
      return withFooter(errorRows(item.text, width), item, theme);
    case 'tool':
      return toolRows(item.line, width, theme);
    case 'plan':
      return [
        ...item.steps.map((s) =>
          row(
            fitSpans(
              [
                {
                  text: `${theme.symbols[s.status === 'done' ? 'done' : s.status === 'doing' ? 'doing' : 'todo']} `,
                  role: s.status === 'done' ? 'accent' : 'muted',
                },
                {
                  text: s.text,
                  ...(s.status === 'pending' && { role: 'muted' as Role }),
                  ...(s.status === 'doing' && { bold: true }),
                },
              ],
              width - TEXT_INDENT,
            ),
          ),
        ),
        ...(item.note
          ? [row(fitSpans([{ text: item.note, role: 'muted' as Role }], width - TEXT_INDENT))]
          : []),
      ];
  }
}

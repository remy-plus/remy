// What the chat shows, as pure functions: tool summaries, approval cards, which tool lines
// are done enough to leave the live area, and how tall the live area may be. No Ink here.
import type { ApprovalRequest, Effect, ToolResult } from '@remy/core';
import { fmtMs, truncate } from './format.ts';

export type ToolState = 'waiting_approval' | 'running' | 'ok' | 'failed' | 'denied';

export interface ToolLine {
  callId: string;
  tool: string;
  /** What it does, in one word: "fetch", "read", "run". */
  verb: string;
  /** What it does it to: a path, a host, a command. */
  target: string;
  state: ToolState;
  startedAt?: number;
  ms?: number;
  /** Why it failed or was denied, short. */
  reason?: string;
  /** More than one when identical failures were collapsed. */
  count: number;
  /** A few lines of what the tool returned, or the hunks of an edit. Shown in the full view. */
  detail?: string[];
}

/** Lines of detail kept per tool call, and the width each is cut to. */
export const DETAIL_LINES = 8;
const DETAIL_WIDTH = 200;

/** What a finished call has to show: edit hunks, or the first lines of its output. */
export function toolDetail(tool: string, args: unknown, result: ToolResult): string[] | undefined {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const cut = (lines: string[], mark = '') => {
    const kept = lines.slice(0, DETAIL_LINES).map((l) => truncate(`${mark}${l}`, DETAIL_WIDTH));
    return lines.length > DETAIL_LINES
      ? [...kept, `${mark}... ${lines.length - DETAIL_LINES} more lines`]
      : kept;
  };
  if (!result.ok) return undefined;
  if (tool === 'edit_file') {
    const half = DETAIL_LINES / 2;
    const old = str(a.old).split('\n');
    const neu = str(a.new).split('\n');
    return [...cut(old.slice(0, half), '- '), ...cut(neu.slice(0, half), '+ ')];
  }
  const lines = result.content.split('\n').filter((l) => l.trim());
  return lines.length ? cut(lines) : undefined;
}

/** The muted tail of a tool row: repeat count, state, reason and, once it is known, time. */
export function toolBits(line: ToolLine, now?: number): string[] {
  const live = line.state === 'running' && line.startedAt && now ? now - line.startedAt : undefined;
  return [
    line.count > 1 ? `×${line.count}` : '',
    line.state === 'waiting_approval' ? 'waiting for approval' : '',
    line.reason ?? '',
    line.ms !== undefined ? fmtMs(line.ms) : live !== undefined && live >= 1000 ? fmtMs(live) : '',
  ].filter(Boolean);
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'doing' | 'done';
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));

/** `https://en.wikipedia.org/wiki/Golden_Hind` becomes `en.wikipedia.org/wiki/Golden_Hind`. */
export function shortUrl(u: string): string {
  return truncate(u.replace(/^https?:\/\//, '').replace(/\/$/, ''), 64);
}

export function summarizeTool(tool: string, args: unknown): { verb: string; target: string } {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  switch (tool) {
    case 'fetch_url':
      return { verb: 'fetch', target: shortUrl(str(a.url)) };
    case 'web_search':
      return { verb: 'search', target: truncate(`"${str(a.query)}"`, 64) };
    case 'read_file':
      return { verb: 'read', target: str(a.path) };
    case 'write_file':
      return { verb: 'write', target: str(a.path) };
    case 'edit_file':
      return { verb: 'edit', target: str(a.path) };
    case 'list_files':
      return { verb: 'list', target: str(a.path) || '.' };
    case 'move_file':
      return { verb: 'move', target: `${str(a.from)} to ${str(a.to)}` };
    case 'delete_file':
      return { verb: 'delete', target: str(a.path) };
    case 'make_dir':
      return { verb: 'create folder', target: str(a.path) };
    case 'run_command': {
      const rest = Array.isArray(a.args) ? a.args.map(String) : [];
      return { verb: 'run', target: truncate([str(a.program), ...rest].join(' '), 64) };
    }
    case 'calculate':
      return { verb: 'calculate', target: truncate(str(a.expression) || str(a.op), 64) };
    default: {
      const first = Object.values(a)[0];
      return { verb: tool, target: first === undefined ? '' : truncate(str(first), 48) };
    }
  }
}

/** Two failures are "the same" when they did the same thing and failed the same way. */
const sameFailure = (a: ToolLine, b: ToolLine) =>
  a.state === 'failed' &&
  b.state === 'failed' &&
  a.verb === b.verb &&
  a.target === b.target &&
  a.reason === b.reason;

const isDone = (l: ToolLine) => l.state === 'ok' || l.state === 'failed' || l.state === 'denied';

/** Folds the failure at `callId` into the line just before it when they are identical. */
export function collapseFailure(lines: ToolLine[], callId: string): ToolLine[] {
  const i = lines.findIndex((l) => l.callId === callId);
  const cur = lines[i];
  const prev = lines[i - 1];
  if (!cur || !prev || !sameFailure(prev, cur)) return lines;
  const merged = { ...prev, count: prev.count + cur.count, ms: (prev.ms ?? 0) + (cur.ms ?? 0) };
  return lines.flatMap((l, j) => (j === i - 1 ? [merged] : j === i ? [] : [l]));
}

/**
 * Splits the live tool lines into those that move to the transcript and those that stay.
 * Only the leading run of finished lines moves, so order is kept. While the task goes on, a
 * trailing failure stays so an identical one can fold into it. With `overflowOnly`, only lines
 * beyond `max` move.
 */
export function flushTools(
  lines: ToolLine[],
  opts: { keepFailure: boolean; max?: number; overflowOnly?: boolean },
): { commit: ToolLine[]; keep: ToolLine[] } {
  let done = 0;
  while (done < lines.length && isDone(lines[done] as ToolLine)) done++;
  let n = opts.overflowOnly ? 0 : done;
  if (
    opts.keepFailure &&
    !opts.overflowOnly &&
    n > 0 &&
    n === lines.length &&
    lines[n - 1]?.state === 'failed'
  )
    n--;
  // Do not let finished lines pile up in the live area.
  if (opts.max !== undefined) n = Math.max(n, done - opts.max);
  return { commit: lines.slice(0, n), keep: lines.slice(n) };
}

const GERUND: Record<string, string> = {
  fetch: 'Fetching',
  search: 'Searching',
  read: 'Reading',
  write: 'Writing',
  edit: 'Editing',
  list: 'Listing',
  move: 'Moving',
  delete: 'Deleting',
  'create folder': 'Creating folder',
  run: 'Running',
  calculate: 'Calculating',
};

/** What the status line says: what is happening now, and where the plan stands. */
export interface NarrateInput {
  streaming: string;
  tools: ToolLine[];
  plan?: PlanStep[];
  /** Seconds since the turn began; omitted when motion is reduced. */
  secs?: number;
  /** Short title of the model's reasoning summary, when the provider streams one. */
  thinkingTitle?: string;
}

/**
 * The title of a reasoning summary: its newest bold heading (`**Planning the move**`), else its
 * first sentence if that is short. Empty when there is nothing to show.
 */
export function reasoningTitle(text: string): string {
  const heads = [...text.matchAll(/\*\*([^*\n]{2,80})\*\*/g)];
  const last = heads.at(-1)?.[1];
  if (last) return last.trim();
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '';
  return first.length > 0 && first.length <= 60 ? first.replace(/[.:]$/, '') : '';
}

/** One calm row: the running tool, else the plan step in progress, else writing or thinking. */
export function narrate(s: NarrateInput): string {
  const running = s.tools.filter((t) => t.state === 'running');
  const first = running[0];
  const doing = s.plan?.find((p) => p.status === 'doing');
  let head: string;
  if (first) {
    const verb = GERUND[first.verb] ?? first.verb;
    head = `${verb}${first.target ? ` ${first.target}` : ''}`;
    if (running.length > 1) head += ` +${running.length - 1} more`;
  } else if (doing) head = doing.text;
  else if (s.streaming) head = 'Writing';
  else head = s.thinkingTitle ? `Thinking: ${s.thinkingTitle}` : 'Thinking';
  if (s.secs === undefined) return `${head}...`;
  const parts = [head];
  if (s.plan && s.plan.length > 1) {
    const at = s.plan.filter((p) => p.status === 'done').length + 1;
    parts.push(`step ${Math.min(at, s.plan.length)} of ${s.plan.length}`);
  }
  parts.push(`${s.secs}s`);
  return parts.join(' · ');
}

export type ApprovalRow = { text: string; kind: 'plain' | 'add' | 'del' | 'dim' };
export interface ApprovalView {
  callId: string;
  title: string;
  /** Every row of the action. The card shows the first few; `v` shows more. */
  rows: ApprovalRow[];
  /** Risk and reason in plain words. */
  risk: string;
  /** First six characters of the argsHash: the approval covers exactly this call. */
  shortHash: string;
  /** False when the tool's effect or risk means it cannot be taken back. */
  reversible: boolean;
  /** Rows hidden in the collapsed card. */
  more: number;
}

/** Rows the collapsed approval card shows. */
export const APPROVAL_ROWS = 6;

const clipLines = (text: string, kind: 'add' | 'del' | 'dim', mark: string, max = 200) => {
  const lines = text.split('\n');
  const rows: ApprovalRow[] = lines
    .slice(0, max)
    .map((l) => ({ text: `${mark}${l}`, kind }) as ApprovalRow);
  if (lines.length > max)
    rows.push({ text: `${mark}... ${lines.length - max} more lines`, kind: 'dim' });
  return rows;
};

/** The approval card's content: what will happen, and the exact thing it will do. */
export function describeApproval(
  tool: string,
  args: unknown,
  req: ApprovalRequest,
  effect?: Effect,
): ApprovalView {
  const reversible = req.risk !== 'irreversible' && effect !== 'unsafe_to_retry';
  // Say it once: some reasons already speak of undoing.
  const undo = /undone/i.test(req.reason)
    ? ''
    : `${reversible ? 'Can usually be undone.' : 'Cannot be undone.'} `;
  const risk = `Risk: ${req.risk}. ${undo}${req.reason}.`;
  const v = rowsFor(tool, args, req, risk);
  return {
    ...v,
    callId: req.callId,
    shortHash: req.argsHash.slice(0, 6),
    reversible,
    more: Math.max(0, v.rows.length - APPROVAL_ROWS),
  };
}

function rowsFor(
  tool: string,
  args: unknown,
  req: ApprovalRequest,
  risk: string,
): { title: string; rows: ApprovalRow[]; risk: string } {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  switch (tool) {
    case 'run_command': {
      const rest = Array.isArray(a.args) ? a.args.map(String) : [];
      const rows: ApprovalRow[] = [
        { text: `$ ${[str(a.program), ...rest].join(' ')}`, kind: 'plain' },
      ];
      if (a.cwd) rows.push({ text: `in ${str(a.cwd)}`, kind: 'dim' });
      return { title: 'Run a command', rows, risk };
    }
    case 'edit_file':
      return {
        title: `Edit ${str(a.path)}`,
        rows: [...clipLines(str(a.old), 'del', '- '), ...clipLines(str(a.new), 'add', '+ ')],
        risk,
      };
    case 'write_file': {
      const content = str(a.content);
      return {
        title: `Write ${str(a.path)}`,
        rows: [
          {
            text: `${content.length} ${content.length === 1 ? 'character' : 'characters'}, replacing the file if it exists`,
            kind: 'dim',
          },
          ...clipLines(content, 'add', '+ '),
        ],
        risk,
      };
    }
    case 'delete_file':
      return {
        title: `Delete ${str(a.path)}`,
        rows: [{ text: 'This cannot be undone.', kind: 'dim' }],
        risk,
      };
    default:
      return { title: req.preview, rows: [], risk };
  }
}

/** The rows to show: the first few, or as many as fit when expanded. */
export function approvalRows(
  v: ApprovalView,
  expanded: boolean,
  room = Number.POSITIVE_INFINITY,
): { shown: ApprovalRow[]; hidden: number } {
  const cap = expanded ? Math.max(APPROVAL_ROWS, room) : APPROVAL_ROWS;
  const shown = v.rows.length > cap ? v.rows.slice(0, cap - 1) : v.rows;
  return { shown, hidden: v.rows.length - shown.length };
}

/** Rows the card takes: border, title, action rows, a "more" line, risk, binding and keys. */
export const approvalHeight = (v: ApprovalView, expanded = false, room?: number) => {
  const { shown, hidden } = approvalRows(v, expanded, room);
  return shown.length + (hidden ? 1 : 0) + 6;
};

/** The steps to show, at most `max`, always including the one in progress. */
export function windowPlan(steps: PlanStep[], max: number): { shown: PlanStep[]; hidden: number } {
  if (steps.length <= max) return { shown: steps, hidden: 0 };
  const focus = Math.max(
    0,
    steps.findIndex((s) => s.status !== 'done'),
  );
  const start = Math.min(Math.max(0, focus - 1), steps.length - max);
  return { shown: steps.slice(start, start + max), hidden: steps.length - max };
}

/** The last `n` of `lines`. */
export const tailLines = <T>(lines: T[], n: number): T[] => (n <= 0 ? [] : lines.slice(-n));

/** Rows left for streaming text once the fixed parts of the live area are counted. */
export function streamBudget(rows: number, fixed: number, cap = 10): number {
  // One row stays free: a frame as tall as the screen makes the terminal redraw everything.
  return Math.max(0, Math.min(cap, rows - 1 - fixed));
}

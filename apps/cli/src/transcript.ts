// What the chat shows, as pure functions: tool summaries, approval cards, which tool lines
// are done enough to leave the live area, and how tall the live area may be. No Ink here.
import type { ApprovalRequest } from '@remy/core';
import { truncate } from './format.ts';

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
  else head = s.streaming ? 'Writing' : 'Thinking';
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
  title: string;
  rows: ApprovalRow[];
  risk: string;
}

const clipLines = (text: string, kind: 'add' | 'del' | 'dim', mark: string, max = 4) => {
  const lines = text.split('\n');
  const rows: ApprovalRow[] = lines
    .slice(0, max)
    .map((l) => ({ text: `${mark}${l}`, kind }) as ApprovalRow);
  if (lines.length > max)
    rows.push({ text: `${mark}... ${lines.length - max} more lines`, kind: 'dim' });
  return rows;
};

/** The approval card's content: what will happen, and the exact thing it will do. */
export function describeApproval(tool: string, args: unknown, req: ApprovalRequest): ApprovalView {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const risk = `Risk: ${req.risk}. ${req.reason}`;
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

export const approvalHeight = (v: ApprovalView) => v.rows.length + 5;

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

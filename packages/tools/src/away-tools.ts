// `whats_new`: what happened since the person was last here, for "hi" and "I'm back". The host
// supplies the records through this port (tasks from the event store, the last-visit time), so
// nothing here touches the disk. It returns one line per task: what was asked and how it ended.
// Raw tool output never appears here; the text is the task's own answer, which Remy wrote. When
// a task had read untrusted content, its answer may repeat that content, so the result is marked
// untrusted, the same rule `recall` follows.
import { defineTool, type Tool } from '@remy/core';
import { z } from 'zod';

export type AwayKind = 'finished' | 'waiting' | 'paused' | 'failed';
export type AwaySource = 'schedule' | 'file watch' | 'webhook' | 'background';

export interface AwayItem {
  taskId: string;
  kind: AwayKind;
  /** ISO time the task last changed. */
  at: string;
  /** What was asked. */
  asked: string;
  /** How it ended: the answer, the card or question it waits on, or why it stopped. */
  outcome: string;
  /** Set when a schedule, a file watch, a webhook or a background run started it. */
  source?: AwaySource;
  /** The task read untrusted content, so its words may repeat it. */
  tainted?: boolean;
}

export interface AwayPort {
  /** When the person last finished a turn here; the host falls back to 24 hours ago. */
  since(): Date;
  /** Tasks that changed since then (waiting and paused ones still open too), without `exclude`. */
  items(since: Date, exclude: string): Promise<AwayItem[]>;
}

/** Most tasks one call lists; the rest are counted. */
export const AWAY_MAX_ITEMS = 10;
const ASKED_CHARS = 90;
const OUTCOME_CHARS = 160;
const GROUPS: { kind: AwayKind; title: string }[] = [
  { kind: 'waiting', title: 'Waiting for the person' },
  { kind: 'paused', title: 'Paused' },
  { kind: 'failed', title: 'Did not finish' },
  { kind: 'finished', title: 'Finished' },
];

const oneLine = (s: string, max: number) => {
  const line = s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** "about 3 hours ago" for the header. */
export function agoWords(since: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (min < 2) return 'a minute ago';
  if (min < 90) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `about ${h} hours ago`;
  return `about ${Math.round(h / 24)} days ago`;
}

/** The tool's text for a list of items; exported so the shape is tested directly. */
export function awayText(items: AwayItem[], since: Date, now: Date): string {
  if (!items.length) return `Nothing new since the person was last here (${agoWords(since, now)}).`;
  const rank = (i: AwayItem) => GROUPS.findIndex((g) => g.kind === i.kind);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at));
  const shown = sorted.slice(0, AWAY_MAX_ITEMS);
  const lines = [`Since the person was last here (${agoWords(since, now)}):`];
  for (const g of GROUPS) {
    const mine = shown.filter((i) => i.kind === g.kind);
    if (!mine.length) continue;
    lines.push(`${g.title}:`);
    for (const i of mine) {
      const by = i.source ? ` [${i.source}]` : '';
      lines.push(
        `- asked "${oneLine(i.asked, ASKED_CHARS)}"${by}: ${oneLine(i.outcome, OUTCOME_CHARS)}`,
      );
    }
  }
  if (sorted.length > shown.length) lines.push(`(and ${sorted.length - shown.length} more)`);
  return lines.join('\n');
}

export function createAwayTool(port: AwayPort, now: () => Date = () => new Date()): Tool {
  return defineTool({
    name: 'whats_new',
    description:
      'What finished, waits for the user or paused since they were last here. When they greet you or say they are back, call it first, then answer in one to three warm, short sentences: waiting items first, only what matters.',
    args: z.object({}),
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 10_000,
    maxOutputChars: 4_000,
    preview: () => 'Check what happened while you were away',
    async execute(_args, ctx) {
      const since = port.since();
      const items = await port.items(since, ctx.taskId);
      return {
        ok: true,
        content: awayText(items, since, now()),
        trust: items.some((i) => i.tainted) ? 'untrusted' : 'trusted',
      };
    },
  });
}

// `remy review`: what ran while the user was away. It reads the event store, the background
// markers and the schedules, and never calls a model. Prompts, tool arguments and card text can
// carry untrusted words, so they are shown as quoted data: control characters removed, cut short.
import {
  type EventStore,
  fold,
  isHelperTask,
  type Risk,
  type TaskStatus,
  waitingCards,
} from '@remy/core';
import { nextCommand, readMarker } from './background.ts';
import { fmtCost } from './format.ts';
import type { Schedule } from './schedule.ts';
import { parseWhen } from './schedule.ts';

export type ReviewSource = 'schedule' | 'file watch' | 'background';

export interface ReviewItem {
  taskId: string;
  /** When the task started. */
  at: string;
  source: ReviewSource;
  prompt: string;
  status: TaskStatus;
  /** One line on why a failed or paused task stopped. */
  reason?: string;
  costUsd: number;
  /** Non-read calls that completed, one short line each. */
  did: string[];
  /** Cards waiting for the user, with the card text. */
  waiting: string[];
  /** The task needs the user, or did not finish. */
  attention: boolean;
}

const PROMPT_MAX = 80;
const DETAIL_MAX = 140;
const CARD_MAX = 300;
const DID_MAX = 6;

/** Text from outside as one clean line: no control characters, cut short. */
export function cleanText(text: string, max: number): string {
  const one = text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
}

/** `24h`, `7d`, `90m` or a date; undefined when it is none of these. */
export function parseSince(text: string, now: Date): Date | undefined {
  const rel = /^(\d+)\s*([mhd])$/i.exec(text.trim());
  if (rel) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[
      (rel[2] as string).toLowerCase()
    ] as number;
    return new Date(now.getTime() - Number(rel[1]) * unit);
  }
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(text.trim())) return undefined;
  const d = new Date(text.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const VERB: Partial<Record<Risk, string>> = {
  write: 'wrote',
  send_as_user: 'sent',
  spend_money: 'spent',
  irreversible: 'changed for good',
};

function argsLine(args: unknown): string {
  if (args === null || typeof args !== 'object') return args === undefined ? '' : String(args);
  return Object.entries(args as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
}

export interface ReviewDeps {
  store: EventStore;
  home: string;
  since: Date;
  schedules?: Schedule[];
}

/** Tasks that started without the user at the keyboard since `since`, needs-attention first. */
export async function collectReview(d: ReviewDeps): Promise<ReviewItem[]> {
  const bySchedule = new Map<string, Schedule>();
  for (const s of d.schedules ?? []) if (s.lastTask) bySchedule.set(s.lastTask, s);
  const items: ReviewItem[] = [];
  for (const t of await d.store.listTasks()) {
    if (isHelperTask(t.taskId) || new Date(t.createdAt) < d.since) continue;
    const sched = bySchedule.get(t.taskId);
    const marker = readMarker(d.home, t.taskId);
    if (!sched && !marker) continue;
    const state = fold(await d.store.read(t.taskId));
    let source: ReviewSource = 'background';
    if (sched) {
      try {
        source = parseWhen(sched.when).kind === 'changes' ? 'file watch' : 'schedule';
      } catch {
        source = 'schedule';
      }
    }
    const did = Object.values(state.calls)
      .sort((a, b) => a.step - b.step)
      .filter((c) => c.result?.ok && c.risk && c.risk !== 'read')
      .map((c) =>
        cleanText(
          `${VERB[c.risk as Risk] ?? c.risk} with ${c.tool} ${argsLine(c.args)}`,
          DETAIL_MAX,
        ),
      );
    const cards = new Map<string, string>();
    if (state.pendingApproval)
      cards.set(state.pendingApproval.callId, state.pendingApproval.preview);
    for (const c of waitingCards(state))
      if (c.approvalRequest) cards.set(c.callId, c.approvalRequest.preview);
    const waiting = [...cards.values()].map((p) => cleanText(p, CARD_MAX));
    const reason =
      state.final?.reason ?? (state.pause ? `the ${state.pause.limit} limit ran out` : undefined);
    const attention =
      state.status === 'failed' ||
      state.status === 'paused' ||
      state.status === 'waiting_approval' ||
      state.status === 'waiting_user' ||
      waiting.length > 0;
    items.push({
      taskId: t.taskId,
      at: marker?.startedAt ?? t.createdAt,
      source,
      prompt: cleanText(state.prompt, PROMPT_MAX),
      status: state.status,
      ...(reason && { reason: cleanText(reason, DETAIL_MAX) }),
      costUsd: state.costUsd,
      did,
      waiting,
      attention,
    });
  }
  return items.sort(
    (a, b) => Number(b.attention) - Number(a.attention) || b.at.localeCompare(a.at),
  );
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  succeeded: 'succeeded',
  failed: 'failed',
  paused: 'paused (budget ran out)',
  waiting_approval: 'waiting for approval',
  waiting_user: 'waiting for your answer',
  running: 'still running',
  cancelled: 'cancelled',
};

/** The review as plain text. */
export function formatReview(items: ReviewItem[], since: Date): string {
  if (!items.length) return 'Nothing ran without you in that time.';
  const need = items.filter((i) => i.attention).length;
  const head = `${items.length} ${items.length === 1 ? 'task' : 'tasks'} ran without you since ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC${need ? `; ${need} need${need === 1 ? 's' : ''} you` : ''}.`;
  const rows = items.flatMap((i) => {
    const shown = i.did.slice(0, DID_MAX);
    const more = i.did.length - shown.length;
    return [
      '',
      `${i.taskId}  ${STATUS_WORDS[i.status]}  ${i.at.slice(0, 16).replace('T', ' ')}  ${i.source}  ${fmtCost(i.costUsd)}`,
      `  Task: "${i.prompt}"`,
      ...(i.reason ? [`  Why: "${i.reason}"`] : []),
      ...(shown.length
        ? [
            `  Changed: ${shown.map((s) => `"${s}"`).join('; ')}${more > 0 ? `; and ${more} more` : ''}`,
          ]
        : []),
      ...i.waiting.map((w) => `  Waiting for approval: "${w}"`),
      ...(i.attention ? [`  Next: ${nextCommand(i.status, i.taskId)}`] : []),
    ];
  });
  return [
    head,
    ...rows,
    '',
    'Text in quotes comes from prompts and tool output. Remy shows it and does not act on it.',
  ].join('\n');
}

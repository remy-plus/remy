// What `whats_new` reads: the tasks that changed while the person was away, from the event store.
// It never calls a model. Finished tasks since the last visit are listed; tasks still waiting for
// the person or paused are listed too, up to a week back, because they still need something.
import {
  type EventStore,
  fold,
  isHelperTask,
  type TaskState,
  type TaskSummary,
  waitingCards,
} from '@remy/core';
import type { AwayItem, AwayKind, AwayPort } from '@remy/tools';
import { readMarker } from './background.ts';
import type { LastSeen } from './last-seen.ts';
import { cleanText, reviewSource } from './review.ts';
import type { Schedule } from './schedule.ts';

/** Open tasks older than this are not news any more. */
const OPEN_DAYS = 7;
/** At most this many of the newest tasks are read per call. */
const LOOK_AT = 60;
const ASKED_MAX = 120;
const OUTCOME_MAX = 240;

const KIND: Partial<Record<TaskState['status'], AwayKind>> = {
  succeeded: 'finished',
  failed: 'failed',
  paused: 'paused',
  waiting_approval: 'waiting',
  waiting_user: 'waiting',
};

function outcomeOf(s: TaskState): string {
  switch (s.status) {
    case 'succeeded':
      return s.final?.answer?.trim() || 'finished';
    case 'failed':
      return s.final?.reason?.trim() || 'it did not finish';
    case 'paused': {
      const why =
        s.pause?.limit === 'model'
          ? 'the model could not be reached'
          : `the ${s.pause?.limit ?? 'budget'} limit ran out`;
      return s.held?.summary ? `${why}; ${s.held.summary}` : why;
    }
    case 'waiting_user':
      return `asks: ${s.pendingQuestion?.question ?? 'it needs an answer'}`;
    default: {
      const cards = new Map<string, string>();
      if (s.pendingApproval) cards.set(s.pendingApproval.callId, s.pendingApproval.preview);
      for (const c of waitingCards(s))
        if (c.approvalRequest) cards.set(c.callId, c.approvalRequest.preview);
      return cards.size ? `needs an OK: ${[...cards.values()].join(' | ')}` : 'needs an OK';
    }
  }
}

export interface AwayDeps {
  store: EventStore;
  home: string;
  seen: LastSeen;
  schedules?: () => Schedule[];
  now?: () => Date;
  /** The task list (default: the store's); a caller that already has it saves a second read. */
  list?: () => Promise<TaskSummary[]>;
}

export function createAwayPort(d: AwayDeps): AwayPort {
  const now = d.now ?? (() => new Date());
  return {
    since: () => d.seen.get(now()),
    async items(since, exclude, limit = LOOK_AT) {
      const openFrom = new Date(
        Math.min(since.getTime(), now().getTime() - OPEN_DAYS * 86_400_000),
      );
      const bySchedule = new Map<string, Schedule>();
      for (const s of d.schedules?.() ?? []) if (s.lastTask) bySchedule.set(s.lastTask, s);
      const kindOf = (s: TaskSummary['status']) => KIND[s];
      const rank = (s: TaskSummary['status']) =>
        ['waiting', 'paused', 'failed', 'finished'].indexOf(kindOf(s) ?? '');
      const candidates = (await (d.list ?? (() => d.store.listTasks()))())
        .filter((t) => t.taskId !== exclude && !isHelperTask(t.taskId))
        .filter((t) => {
          const kind = KIND[t.status];
          if (!kind) return false;
          const open = kind === 'waiting' || kind === 'paused';
          return new Date(t.updatedAt) >= (open ? openFrom : since);
        })
        // Waiting first, then the newest: with a small `limit` the ones that matter are the ones read.
        .sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
      const out: AwayItem[] = [];
      for (const t of candidates) {
        const state = fold(await d.store.read(t.taskId));
        const kind = KIND[state.status];
        if (!kind) continue;
        const sched = bySchedule.get(t.taskId);
        const source =
          sched || readMarker(d.home, t.taskId) || /^\[webhook /.test(state.prompt)
            ? reviewSource(sched, state.prompt)
            : undefined;
        out.push({
          taskId: t.taskId,
          kind,
          at: t.updatedAt,
          asked: cleanText(state.prompt, ASKED_MAX),
          outcome: cleanText(outcomeOf(state), OUTCOME_MAX),
          ...(source && { source }),
          ...((state.tainted || source === 'webhook') && { tainted: true }),
        });
      }
      return out;
    },
  };
}

// A task whose budget ran out waits instead of failing. These helpers word the pause and work out
// how much more to offer, for `remy continue`, `remy run` and the chat.
import type { RunOutcome, TaskState } from '@remy/core';

const usd = (n: number) => `$${n.toFixed(2)}`;

export interface More {
  steps?: number;
  costUsd?: number;
  wallMs?: number;
}

export type Paused = Extract<RunOutcome, { status: 'paused' }>;

/** The budget the task started with, offered again by default. */
export const defaultMore = (s: Pick<TaskState, 'initialBudget'>): Required<More> => ({
  steps: s.initialBudget.maxSteps,
  costUsd: s.initialBudget.maxCostUsd,
  wallMs: s.initialBudget.maxWallMs,
});

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** "Paused after 30 steps and $0.42. Continue for 30 more steps?" */
export function pauseQuestion(o: Paused, more: Required<More>): string {
  const spent = `${o.steps} ${o.steps === 1 ? 'step' : 'steps'} and ${usd(o.costUsd)}`;
  const offer =
    o.limit === 'cost'
      ? `${usd(more.costUsd)} more`
      : o.limit === 'time'
        ? `${minutes(more.wallMs)} more minutes`
        : `${more.steps} more steps`;
  return `Paused after ${spent}. Continue for ${offer}?`;
}

/** The command that continues a paused task later. */
export const continueCommand = (id: string) => `remy continue ${id}`;

/** What `remy continue` adds: flags win, otherwise the original budget again. */
export function moreFor(
  s: Pick<TaskState, 'initialBudget' | 'pause'>,
  flags: { steps?: number; costUsd?: number },
): More {
  const base = defaultMore(s);
  if (flags.steps === undefined && flags.costUsd === undefined) return base;
  // A task paused by time needs more time whatever else was asked for.
  return {
    ...(flags.steps !== undefined && { steps: flags.steps }),
    ...(flags.costUsd !== undefined && { costUsd: flags.costUsd }),
    ...(s.pause?.limit === 'time' && { wallMs: base.wallMs }),
  };
}

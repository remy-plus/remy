// nextAction(state) decides the runner's next move from persisted state alone, so a crash
// anywhere is recovered by re-reading the events and asking again. Pure.
import { type CallState, isTerminal, type TaskState } from './state.ts';
import type { FinalStatus } from './types.ts';

export type Action =
  | { kind: 'done' }
  | { kind: 'pause' }
  | { kind: 'finish'; status: FinalStatus; answer?: string; reason?: string }
  | { kind: 'call_model' }
  | { kind: 'decide'; callId: string }
  | { kind: 'request_approval'; callId: string }
  | { kind: 'execute'; callId: string }
  | { kind: 'ask_user'; callId: string }
  /** The model asked a question in plain text instead of calling ask_user. */
  | { kind: 'ask'; question: string }
  | { kind: 'answer_call'; callId: string }
  | { kind: 'recover'; callId: string }
  | { kind: 'resolve_uncertain'; callId: string };

/** Identical (tool, args) calls allowed per task before the runner stops. */
export const MAX_IDENTICAL_CALLS = 3;
export const MAX_MODEL_ATTEMPTS = 3;
export const MAX_TOOL_ATTEMPTS = 3;

export function currentCalls(s: TaskState): CallState[] {
  return Object.values(s.calls).filter((c) => c.step === s.step);
}

export function nextAction(s: TaskState, now: number): Action {
  if (isTerminal(s.status)) return { kind: 'done' };
  if (s.cancelRequested) return { kind: 'finish', status: 'cancelled', reason: 'Cancelled.' };
  if (s.status !== 'running') return { kind: 'pause' };
  if (now - s.createdAt > s.config.budget.maxWallMs)
    return fail('Stopped: the task ran past its time budget.');

  const calls = currentCalls(s);
  for (const c of calls) {
    if (c.result) continue;
    if (c.inFlight) return { kind: 'recover', callId: c.callId };
    if (!c.decision) return { kind: 'decide', callId: c.callId };
    if (c.decision.kind === 'require_approval' && !c.approval)
      return { kind: 'request_approval', callId: c.callId };
    if (c.tool === 'ask_user')
      return { kind: c.userAnswer === undefined ? 'ask_user' : 'answer_call', callId: c.callId };
    if (c.attempts > 0 && c.userAnswer !== undefined)
      return { kind: 'resolve_uncertain', callId: c.callId };
    return { kind: 'execute', callId: c.callId };
  }

  // Every call of the current step is resolved.
  const done = calls.find((c) => c.tool === 'finish' && c.result?.ok);
  if (done?.result?.ok) return { kind: 'finish', status: 'succeeded', answer: done.result.content };
  // A text-only reply is the answer, unless it is just a question. Once the user has answered,
  // the last entry is theirs and the model goes again.
  const last = s.log.at(-1);
  if (s.step > 0 && calls.length === 0 && last?.kind === 'model') {
    const text = last.text?.trim() ?? '';
    if (isQuestion(text)) return { kind: 'ask', question: text };
    return { kind: 'finish', status: 'succeeded', answer: last.text };
  }

  // A different call that succeeds is progress, so it resets the count for every other call.
  const seen = new Map<string, number>();
  for (const c of Object.values(s.calls)) {
    const key = `${c.tool}:${c.argsHash}`;
    const n = (seen.get(key) ?? 0) + 1;
    if (c.result?.ok) seen.clear();
    seen.set(key, n);
    if (n >= MAX_IDENTICAL_CALLS)
      return fail(`Stopped: repeated the same ${c.tool} call ${n} times without progress.`);
  }
  const { maxSteps, maxCostUsd } = s.config.budget;
  if (s.step >= maxSteps) return fail(`Stopped: reached the limit of ${maxSteps} steps.`);
  if (s.costUsd >= maxCostUsd)
    return fail(`Stopped: reached the cost limit of $${maxCostUsd.toFixed(2)}.`);
  return { kind: 'call_model' };
}

/** One short sentence ending in "?". Longer replies that end with an offer are answers. */
export const isQuestion = (text: string) =>
  text.length <= 300 && text.endsWith('?') && !/[.!?]\s|\n/.test(text.slice(0, -1));

const fail = (reason: string): Action => ({ kind: 'finish', status: 'failed', reason });

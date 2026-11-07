// nextAction(state) decides the runner's next move from persisted state alone, so a crash
// anywhere is recovered by re-reading the events and asking again. Pure.
import { openPlanSteps, planGateUsed, UPDATE_PLAN } from './plan.ts';
import { sourceGateMessage, sourceGateUsed, sourceProblems } from './sources.ts';
import { type CallState, isTerminal, type TaskState } from './state.ts';
import { type FinalStatus, PROGRESS_EVERY } from './types.ts';

export type Action =
  | { kind: 'done' }
  | { kind: 'pause' }
  | { kind: 'finish'; status: FinalStatus; answer?: string; reason?: string }
  | { kind: 'call_model' }
  /** A limit ran out: pause the task (the user can extend it). */
  | { kind: 'exhaust'; limit: 'steps' | 'cost' | 'time' }
  /** Record a one-line progress note. */
  | { kind: 'progress' }
  /** `finish` with plan steps open or claiming work no tool did: answer with a tool error, once. */
  | { kind: 'gate_finish'; callId: string }
  /** A plain-text stop with plan steps open: send the model back to work once. */
  | { kind: 'gate_text' }
  /** A plain-text stop that claims or promises work when no tool ran: send it back once. */
  | { kind: 'gate_claim' }
  /** A web answer with unchecked sources: push back once, as a tool error on `finish` or as a note. */
  | { kind: 'gate_sources'; message: string; callId?: string }
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
export const MAX_MODEL_ATTEMPTS = 5;
/** Rate limits clear with time, so they get more attempts and longer waits. */
export const MAX_RATE_LIMITED_ATTEMPTS = 6;
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
export const MAX_TOOL_ATTEMPTS = 3;

/** The same request at temperature 0 gets the same malformed reply back, so a retry has to vary. */
export const temperatureFor = (failedAttempts: number) => Math.min(failedAttempts * 0.3, 0.9);

export function currentCalls(s: TaskState): CallState[] {
  return Object.values(s.calls).filter((c) => c.step === s.step);
}

export function nextAction(s: TaskState, now: number): Action {
  if (isTerminal(s.status)) return { kind: 'done' };
  if (s.cancelRequested) return { kind: 'finish', status: 'cancelled', reason: 'Cancelled.' };
  if (s.status !== 'running') return { kind: 'pause' };
  if (now - s.createdAt > s.config.budget.maxWallMs) return { kind: 'exhaust', limit: 'time' };

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
    if (c.tool === 'finish') {
      const claims = unbackedClaim(s, finishAnswer(c));
      if (!planGateUsed(s) && (openPlanSteps(s).length || claims))
        return { kind: 'gate_finish', callId: c.callId };
      if (claims && provablyFalse(s)) return fail(NOTHING_DONE);
      const problems = sourceGateUsed(s) ? [] : sourceProblems(s, finishAnswer(c));
      if (problems.length)
        return { kind: 'gate_sources', callId: c.callId, message: sourceGateMessage(problems) };
    }
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
    if (isQuestion(text) || isStalledAsk(text) || isEmptyOffer(text))
      return { kind: 'ask', question: text };
    if (!planGateUsed(s) && openPlanSteps(s).length) return { kind: 'gate_text' };
    if (unbackedClaim(s, text)) {
      if (!planGateUsed(s)) return { kind: 'gate_claim' };
      if (provablyFalse(s)) return fail(NOTHING_DONE);
    }
    if (ranNoTools(s) && isPromisedWork(text) && !planGateUsed(s)) return { kind: 'gate_claim' };
    const problems = sourceGateUsed(s) ? [] : sourceProblems(s, text);
    if (problems.length) return { kind: 'gate_sources', message: sourceGateMessage(problems) };
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
  if (s.step >= maxSteps) return { kind: 'exhaust', limit: 'steps' };
  if (s.costUsd >= maxCostUsd) return { kind: 'exhaust', limit: 'cost' };
  if (s.step > 0 && s.step % PROGRESS_EVERY === 0 && s.progressAt < s.step)
    return { kind: 'progress' };
  return { kind: 'call_model' };
}

/** Tools that report on the work rather than do any of it. */
const NOT_WORK = new Set(['finish', 'ask_user', UPDATE_PLAN]);

/** No tool has done anything yet: at most the model has planned, asked or tried to finish. */
const ranNoTools = (s: TaskState) =>
  !Object.values(s.calls).some((c) => !NOT_WORK.has(c.tool) && c.result?.ok);

/**
 * Only reads so far. A call from before risk was recorded counts as an action. Browser clicks are
 * reads, so this alone is never grounds to fail a task: it earns one push back, no more.
 */
const changedNothing = (s: TaskState) =>
  !Object.values(s.calls).some((c) => !NOT_WORK.has(c.tool) && c.result?.ok && c.risk !== 'read');

/** The reply says something happened, and the tools that ran could not have done it. */
const unbackedClaim = (s: TaskState, text: string) =>
  (ranNoTools(s) && isClaimedWork(text)) || (changedNothing(s) && isClaimedAction(text));

/** Nothing ran at all, or an action was tried and stopped: the claim cannot be true. */
const provablyFalse = (s: TaskState) =>
  ranNoTools(s) ||
  Object.values(s.calls).some((c) => c.risk && c.risk !== 'read' && c.result && !c.result.ok);

const finishAnswer = (c: CallState) => String((c.args as { answer?: unknown })?.answer ?? '');

/**
 * One short sentence that asks ("…?") or asks for something ("Please provide your manager's
 * email."). Longer replies that end with an offer are answers.
 */
export const isQuestion = (text: string) =>
  !GREETING.test(text) &&
  text.length <= 300 &&
  (text.endsWith('?') || (text.endsWith('.') && REQUEST.test(text))) &&
  !/[.!?]\s|\n/.test(text.slice(0, -1));

/**
 * A long reply that has not done the work: it puts several questions to the user and closes by
 * asking for the answers. An answer that ends with an offer has neither.
 */
export const isStalledAsk = (text: string) =>
  (text.match(/\?(\s|$)|would you like/gi)?.length ?? 0) >= 2 &&
  REQUEST.test(
    text
      .split(/\n\s*\n/)
      .at(-1)
      ?.trim() ?? '',
  );

/**
 * A reply that says the work came up empty and closes by offering to try something else. It has
 * no answer in it, so it pauses for the user instead of counting as a success. An answer with an
 * offer on the end says nothing of the kind.
 */
export const isEmptyOffer = (text: string) => {
  const parts = text.split(/\n\s*\n/);
  const closing = parts.at(-1)?.trim() ?? '';
  return (
    OFFER.test(closing) &&
    NOTHING_FOUND.test(parts.length > 1 ? parts.slice(0, -1).join(' ') : text)
  );
};

/**
 * A reply that says it acted in the world or finished the job. With no tool run, that is false:
 * nothing happened, and reporting it as a success would tell the user that it did. Work done
 * earlier is a fair thing to mention, and so is text written in the reply itself.
 */
export const isClaimedWork = (text: string) => claimsAny(text, [...ACTION_CLAIMS, ...DONE_CLAIMS]);

/** A claim of acting in the world in particular. "The task is done" is fair after reading. */
export const isClaimedAction = (text: string) => claimsAny(text, ACTION_CLAIMS);

const claimsAny = (text: string, claims: RegExp[]) => {
  const t = text.replace(/\u2019/g, "'");
  return !DONE_BEFORE.test(t) && claims.some((re) => re.test(t));
};

/** A reply that says it is about to start. Ending there leaves the work undone. */
export const isPromisedWork = (text: string) =>
  /\b(?:(?:let's|let me|i'll|i will) (?:now |first )?(?:start|begin)\b|(?:i'll|i will) now\b|(?:first|now),? (?:i'll|i will|let me)\b)/i.test(
    text.replace(/\u2019/g, "'"),
  );

const DONE_BEFORE =
  /\b(earlier|previously|yesterday|last (week|month|night|time)|the other day|in (a|an|our) (previous|earlier|past))\b/i;
const ACTED =
  'sent|emailed|saved|deleted|moved|renamed|booked|ordered|purchased|bought|paid|posted|published|uploaded|scheduled|submitted|cancelled';
const I_DID = "\\b(?:i|i've|we|we've)\\s+(?:(?:have|just|now|also|already|successfully)\\s+)*";
const FILE_NAME = '(?:\\S+\\.[a-z]{2,4}\\b|(?:the |a |your )?file\\b)';
const ACTION_CLAIMS = [
  new RegExp(`${I_DID}(?:${ACTED})\\b`, 'i'),
  new RegExp(`${I_DID}(?:wrote|written|created|updated)\\s+(?:to\\s+)?${FILE_NAME}`, 'i'),
  new RegExp(`\\b(?:has|have) been (?:successfully )?(?:${ACTED})\\b`, 'i'),
  new RegExp(`^\\s*(?:[-*\u2022]|\\d+[.)])\\s+(?:${ACTED}|wrote|created|updated)\\b`, 'im'),
];
const DONE_CLAIMS = [
  /\b(?:completed|finished) (?:the|your|this|all(?: the)?) (?:task|tasks|work|steps)\b/i,
  /\btask is (?:now )?(?:complete|completed|done|finished)\b/i,
];

export const NOTHING_DONE =
  'Nothing was done. The model said it finished the work but never used a tool. Try again, or pick a stronger model.';

const OFFER =
  /(would you like|do you want|want me to|shall i|should i|if you('d| would) like|if you want|i can (try|also|instead)|i could (try|also|instead)|let me know if)\b/i;

const NOTHING_FOUND =
  /\b(could ?n[o']t|was ?n[o']t able to|were ?n[o']t able to|unable to|failed to|did ?n[o']t|cannot|can ?not|can't) (find|locate|get|retrieve|load|open|reach|confirm|verify)\b|\bno (reliable |useful |relevant |usable )?(results|sources|information|data|matches)\b|\bsearch(es)? (came back|returned|were|was) (empty|nothing|no\b)/i;

/** "Hello there, ready to help?" is a reply, not a question that needs an answer to go on. */
const GREETING = /^(hi|hello|hey|good (morning|afternoon|evening))\b/i;

const REQUEST =
  /^(please |kindly )?(provide|share|tell me|send me|give me|specify|confirm|let me know (what|which|who|where|when|your|the))\b/i;

const fail = (reason: string): Action => ({ kind: 'finish', status: 'failed', reason });

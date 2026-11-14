// TaskState = fold(events). The reducer is pure and rejects invalid transitions, so a
// state that exists in memory is always one the event log could have produced.
import {
  type ApprovalRequest,
  type Budget,
  type Event,
  type EventType,
  FIND_TOOLS,
  type FinalStatus,
  MAX_WAITING_CARDS,
  type PlannedCall,
  type PolicyDecision,
  type Risk,
  type StoredEvent,
  type TaskConfig,
  type TaskStatus,
  type ToolResult,
  type Usage,
} from './types.ts';

export interface CallState extends PlannedCall {
  step: number;
  decision?: PolicyDecision;
  /** Absent in events written before risk was recorded. */
  risk?: Risk;
  approvalRequest?: ApprovalRequest;
  /** The card waits while the task carries on (see `approval.requested`). Never unset. */
  parked?: boolean;
  approval?: { argsHash: string; granted: boolean; by: string };
  /** Number of `tool.started` events. */
  attempts: number;
  /** Started and neither completed nor failed: the outcome is unknown. */
  inFlight: boolean;
  lastError?: string;
  reconciled?: 'already_done' | 'not_done' | 'unknown';
  /** The user's answer to a question about this call (ask_user, or an uncertain recovery). */
  userAnswer?: string;
  /** Segments of `userAnswer` the user pasted. */
  userAnswerPasted?: string[];
  result?: ToolResult;
}

export type LogEntry =
  | { kind: 'user'; text: string; pasted?: string[] }
  | { kind: 'model'; step: number; text?: string; callIds: string[] }
  | { kind: 'result'; callId: string }
  /** The outcome of a parked call, told to the model after the step it was proposed in. */
  | { kind: 'late'; callId: string }
  /** A parked call's place in the conversation: it is waiting for the user and has not run. */
  | { kind: 'parked'; callId: string };

export interface TaskState {
  taskId: string;
  prompt: string;
  config: TaskConfig;
  status: TaskStatus;
  seq: number;
  createdAt: number;
  /** Number of model responses so far. */
  step: number;
  calls: Record<string, CallState>;
  log: LogEntry[];
  tainted: boolean;
  /** Selectable tools that `find_tools` returned, oldest first. They stay offered for the rest of the task. */
  discovered: string[];
  /** Tools the user chose to always allow during this task, on top of `config.permissions.standing`. */
  alwaysAllowed: string[];
  usage: Usage;
  costUsd: number;
  /** Failed model attempts for the next step. Reset on each response. */
  modelAttempts: number;
  pendingApproval?: ApprovalRequest;
  /** Set while the task is paused with parked cards: what is done and what waits. */
  held?: { summary: string };
  pendingQuestion?: { question: string; callId?: string };
  /** Set while status is `paused`: which limit ran out and what was spent. */
  pause?: { limit: 'steps' | 'cost' | 'time'; steps: number; costUsd: number; elapsedMs: number };
  /** The budget the task started with; `remy continue` offers it again by default. */
  initialBudget: Budget;
  /** The step of the last progress note (0: none yet). */
  progressAt: number;
  /** A gate already sent a plain-text stop back to work (see `plan.gated`). */
  planGated: boolean;
  /** The source check has pushed back once on a plain-text reply. */
  sourceGated: boolean;
  cancelRequested: boolean;
  final?: { status: FinalStatus; answer?: string; reason?: string };
}

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
}

const OPEN: TaskStatus[] = ['running', 'waiting_approval', 'waiting_user', 'paused'];

const ALLOWED_FROM: Record<Exclude<EventType, 'task.created'>, TaskStatus[]> = {
  'model.responded': ['running'],
  'model.failed': ['running'],
  'policy.decided': ['running'],
  'approval.requested': ['running'],
  'approval.resolved': OPEN,
  'approvals.held': ['running'],
  'tool.started': ['running'],
  'tool.completed': ['running'],
  'tool.failed': ['running'],
  'tool.reconciled': ['running'],
  'user.asked': ['running'],
  'user.answered': ['waiting_user'],
  'budget.exhausted': ['running'],
  'budget.extended': ['paused'],
  progress: ['running'],
  'plan.gated': ['running'],
  'task.cancel_requested': OPEN,
  'task.finished': OPEN,
};

/** Parked cards nobody has answered yet, oldest first. Derived from events, so a crash re-derives it. */
export const waitingCards = (s: Pick<TaskState, 'calls'>): CallState[] =>
  Object.values(s.calls).filter((c) => c.parked && c.approvalRequest && !c.approval && !c.result);

/**
 * Whether a new card may wait while the task carries on. Only at the `away` level, only for the
 * task's own calls (a helper's card goes to the user at once) and only while fewer than
 * MAX_WAITING_CARDS wait; the next one stops the task as it always has.
 */
export const canPark = (s: Pick<TaskState, 'calls' | 'config' | 'pendingApproval'>) =>
  s.config.permissions.trust === 'away' &&
  !s.config.parent &&
  !s.config.helperRole &&
  !s.pendingApproval &&
  waitingCards(s).length < MAX_WAITING_CARDS;

export const isTerminal = (status: TaskStatus) => !OPEN.includes(status);

export function fold(events: StoredEvent[]): TaskState {
  let state: TaskState | undefined;
  for (const e of events) state = apply(state, e);
  if (!state) throw new InvalidTransitionError('no events');
  return state;
}

/** Pure: returns a new state and leaves the input untouched. */
export function reduce(state: TaskState | undefined, e: StoredEvent): TaskState {
  return apply(state ? structuredClone(state) : undefined, e);
}

function fail(msg: string): never {
  throw new InvalidTransitionError(msg);
}

function apply(s: TaskState | undefined, stored: StoredEvent): TaskState {
  const e = stored.event;
  if (e.type === 'task.created') {
    if (s) fail('task.created on an existing task');
    if (stored.seq !== 1) fail('task.created must be seq 1');
    return {
      taskId: stored.taskId,
      prompt: e.prompt,
      config: { ...e.config, budget: { ...e.config.budget } },
      initialBudget: { ...e.config.budget },
      progressAt: 0,
      planGated: false,
      sourceGated: false,
      status: 'running',
      seq: 1,
      createdAt: Date.parse(stored.at),
      step: 0,
      calls: {},
      log: [{ kind: 'user', text: e.prompt }],
      discovered: [],
      alwaysAllowed: [],
      tainted: (e.config.pasted?.length ?? 0) > 0 || e.config.startTainted === true,
      usage: { inTokens: 0, outTokens: 0 },
      costUsd: 0,
      modelAttempts: 0,
      cancelRequested: false,
    };
  }
  if (!s) return fail(`${e.type} before task.created`);
  if (stored.taskId !== s.taskId) fail(`event for ${stored.taskId} applied to ${s.taskId}`);
  if (stored.seq !== s.seq + 1) fail(`expected seq ${s.seq + 1}, got ${stored.seq}`);
  if (!ALLOWED_FROM[e.type].includes(s.status)) fail(`${e.type} not allowed while ${s.status}`);
  s.seq = stored.seq;
  on(s, e);
  return s;
}

function callOf(s: TaskState, callId: string): CallState {
  return s.calls[callId] ?? fail(`unknown call ${callId}`);
}

function open(call: CallState): CallState {
  if (call.result) fail(`call ${call.callId} already has a result`);
  return call;
}

function setResult(s: TaskState, call: CallState, result: ToolResult) {
  call.result = result;
  call.inFlight = false;
  if (result.trust === 'untrusted') s.tainted = true;
  if (result.ok && result.spentUsd) s.costUsd += result.spentUsd;
  if (result.ok && call.tool === FIND_TOOLS) {
    const names = (result.data as { names?: unknown } | undefined)?.names;
    if (Array.isArray(names))
      for (const n of names)
        if (typeof n === 'string' && !s.discovered.includes(n)) s.discovered.push(n);
  }
  s.log.push({ kind: call.parked ? 'late' : 'result', callId: call.callId });
}

function on(s: TaskState, e: Event) {
  switch (e.type) {
    case 'task.created':
      return fail('unreachable');
    case 'model.responded': {
      if (e.step !== s.step + 1) fail(`expected step ${s.step + 1}, got ${e.step}`);
      const unresolved = Object.values(s.calls).find(
        (c) => !c.result && !(c.parked && !c.approval),
      );
      if (unresolved) fail(`model.responded while ${unresolved.callId} is unresolved`);
      s.step = e.step;
      s.modelAttempts = 0;
      s.usage.inTokens += e.usage.inTokens;
      s.usage.outTokens += e.usage.outTokens;
      if (e.usage.cachedInTokens)
        s.usage.cachedInTokens = (s.usage.cachedInTokens ?? 0) + e.usage.cachedInTokens;
      s.costUsd += e.costUsd;
      for (const c of e.calls) {
        if (s.calls[c.callId]) fail(`duplicate callId ${c.callId}`);
        s.calls[c.callId] = { ...c, step: e.step, attempts: 0, inFlight: false };
      }
      s.log.push({
        kind: 'model',
        step: e.step,
        text: e.text,
        callIds: e.calls.map((c) => c.callId),
      });
      return;
    }
    case 'model.failed':
      s.modelAttempts += 1;
      return;
    case 'policy.decided': {
      const call = open(callOf(s, e.callId));
      if (call.decision) fail(`call ${e.callId} already decided`);
      call.decision = e.decision;
      if (e.risk) call.risk = e.risk;
      if (e.decision.kind === 'deny') {
        setResult(s, call, {
          ok: false,
          error: `Not allowed: ${e.decision.reason}`,
          retryable: false,
          phase: 'before_effect',
        });
      }
      return;
    }
    case 'approval.requested': {
      const call = open(callOf(s, e.callId));
      if (call.decision?.kind !== 'require_approval')
        fail(`call ${e.callId} doesn't need approval`);
      if (e.argsHash !== call.argsHash)
        fail(`approval request for ${e.callId} has the wrong argsHash`);
      const { type: _, ...request } = e;
      call.approvalRequest = request;
      if (e.parked !== undefined) {
        const n = waitingCards(s).length + 1;
        if (e.parked !== n || n > MAX_WAITING_CARDS)
          fail(`card for ${e.callId} cannot wait as number ${e.parked}`);
        if (s.config.permissions.trust !== 'away' || s.config.parent || s.config.helperRole)
          fail(`card for ${e.callId} cannot wait at this trust level`);
        call.parked = true;
        s.log.push({ kind: 'parked', callId: call.callId });
        return;
      }
      s.pendingApproval = request;
      s.status = 'waiting_approval';
      return;
    }
    case 'approval.resolved': {
      const call = open(callOf(s, e.callId));
      const pending = s.pendingApproval?.callId === e.callId;
      if (!pending && !(call.parked && call.approvalRequest && !call.approval))
        fail(`no pending approval for ${e.callId}`);
      if (!call.parked && s.status !== 'waiting_approval')
        fail(`approval.resolved not allowed while ${s.status}`);
      if (e.argsHash !== call.argsHash)
        fail(`approval for ${e.callId} doesn't match its arguments`);
      call.approval = { argsHash: e.argsHash, granted: e.granted, by: e.by };
      if (e.granted && e.always && !s.alwaysAllowed.includes(call.tool))
        s.alwaysAllowed.push(call.tool);
      if (pending) s.pendingApproval = undefined;
      const cards = waitingCards(s);
      const stop = s.pendingApproval && !cards.some((c) => c.callId === s.pendingApproval?.callId);
      const left = cards.length + (stop ? 1 : 0);
      if (call.parked && e.left !== left) fail(`${e.callId}: ${left} approvals left`);
      if (s.status === 'waiting_approval') {
        if (s.held) {
          const next = cards[0]?.approvalRequest;
          if (next) s.pendingApproval = next;
          else {
            s.held = undefined;
            s.pendingApproval = undefined;
            s.status = 'running';
          }
        } else if (!s.pendingApproval) s.status = 'running';
      }
      if (!e.granted) {
        setResult(s, call, {
          ok: false,
          // Do not retry it or find a way around it; but a fallback the user named in their own
          // request ("if you cannot send it, save it") is what they asked for, so it stands.
          error: `${
            e.note
              ? `The user declined this action and said: ${e.note}`
              : 'The user declined this action.'
          } Do not try it again or another way. If the user's own request already said what to do in that case, do that; otherwise say it was declined and finish.`,
          retryable: false,
          phase: 'before_effect',
        });
      }
      return;
    }
    case 'approvals.held': {
      const cards = waitingCards(s);
      if (!cards.length) fail('approvals.held with no card waiting');
      s.held = { summary: e.summary };
      s.pendingApproval = cards[0]?.approvalRequest;
      s.status = 'waiting_approval';
      return;
    }
    case 'tool.started': {
      const call = open(callOf(s, e.callId));
      if (call.inFlight) fail(`call ${e.callId} is already in flight`);
      if (e.attempt !== call.attempts + 1) fail(`expected attempt ${call.attempts + 1}`);
      call.attempts = e.attempt;
      call.inFlight = true;
      call.reconciled = undefined;
      call.userAnswer = undefined;
      return;
    }
    case 'tool.failed': {
      const call = open(callOf(s, e.callId));
      if (!call.inFlight) fail(`tool.failed for ${e.callId}, which isn't in flight`);
      call.inFlight = false;
      call.lastError = e.error;
      return;
    }
    case 'tool.reconciled': {
      const call = open(callOf(s, e.callId));
      if (!call.inFlight) fail(`tool.reconciled for ${e.callId}, which isn't in flight`);
      call.reconciled = e.outcome;
      if (e.outcome === 'not_done') call.inFlight = false;
      return;
    }
    case 'tool.completed':
      setResult(s, open(callOf(s, e.callId)), e.result);
      return;
    case 'user.asked':
      if (e.callId) open(callOf(s, e.callId));
      s.pendingQuestion = { question: e.question, callId: e.callId };
      s.status = 'waiting_user';
      return;
    case 'user.answered': {
      const q = s.pendingQuestion ?? fail('no pending question');
      if (q.callId) {
        const call = callOf(s, q.callId);
        call.userAnswer = e.answer;
        if (e.pasted?.length) call.userAnswerPasted = e.pasted;
        // The user now owns the uncertain outcome; the runner retries or skips.
        call.inFlight = false;
      } else
        s.log.push({
          kind: 'user',
          text: e.answer,
          ...(e.pasted?.length && { pasted: e.pasted }),
        });
      if (e.pasted?.length) s.tainted = true;
      s.pendingQuestion = undefined;
      s.status = 'running';
      return;
    }
    case 'budget.exhausted':
      s.pause = { limit: e.limit, steps: e.steps, costUsd: e.costUsd, elapsedMs: e.elapsedMs };
      s.status = 'paused';
      return;
    case 'budget.extended':
      s.config.budget = {
        ...s.config.budget,
        maxSteps: e.maxSteps,
        maxCostUsd: e.maxCostUsd,
        maxWallMs: e.maxWallMs,
      };
      s.pause = undefined;
      s.status = 'running';
      return;
    case 'progress':
      s.progressAt = e.step;
      return;
    case 'plan.gated':
      if (e.source) s.sourceGated = true;
      else s.planGated = true;
      s.log.push({ kind: 'user', text: e.text });
      return;
    case 'task.cancel_requested':
      s.cancelRequested = true;
      return;
    case 'task.finished':
      s.status = e.status;
      s.final = { status: e.status, answer: e.answer, reason: e.reason };
      s.pendingApproval = undefined;
      s.held = undefined;
      s.pendingQuestion = undefined;
      s.pause = undefined;
      return;
  }
}

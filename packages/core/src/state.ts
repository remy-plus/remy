// TaskState = fold(events). The reducer is pure and rejects invalid transitions, so a
// state that exists in memory is always one the event log could have produced.
import {
  type ApprovalRequest,
  type Budget,
  type Event,
  type EventType,
  FIND_TOOLS,
  type FinalStatus,
  type PlannedCall,
  type PolicyDecision,
  type StoredEvent,
  type TaskConfig,
  type TaskStatus,
  type ToolResult,
  type Usage,
} from './types.ts';

export interface CallState extends PlannedCall {
  step: number;
  decision?: PolicyDecision;
  approvalRequest?: ApprovalRequest;
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
  | { kind: 'result'; callId: string };

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
  pendingQuestion?: { question: string; callId?: string };
  /** Set while status is `paused`: which limit ran out and what was spent. */
  pause?: { limit: 'steps' | 'cost' | 'time'; steps: number; costUsd: number; elapsedMs: number };
  /** The budget the task started with; `remy continue` offers it again by default. */
  initialBudget: Budget;
  /** The step of the last progress note (0: none yet). */
  progressAt: number;
  /** The plan gate already sent a plain-text stop back to work (see `plan.gated`). */
  planGated: boolean;
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
  'approval.resolved': ['waiting_approval'],
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
      status: 'running',
      seq: 1,
      createdAt: Date.parse(stored.at),
      step: 0,
      calls: {},
      log: [{ kind: 'user', text: e.prompt }],
      discovered: [],
      alwaysAllowed: [],
      tainted: (e.config.pasted?.length ?? 0) > 0,
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
  if (result.ok && result.trust === 'untrusted') s.tainted = true;
  if (result.ok && call.tool === FIND_TOOLS) {
    const names = (result.data as { names?: unknown } | undefined)?.names;
    if (Array.isArray(names))
      for (const n of names)
        if (typeof n === 'string' && !s.discovered.includes(n)) s.discovered.push(n);
  }
  s.log.push({ kind: 'result', callId: call.callId });
}

function on(s: TaskState, e: Event) {
  switch (e.type) {
    case 'task.created':
      return fail('unreachable');
    case 'model.responded': {
      if (e.step !== s.step + 1) fail(`expected step ${s.step + 1}, got ${e.step}`);
      const unresolved = Object.values(s.calls).find((c) => !c.result);
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
      s.pendingApproval = request;
      s.status = 'waiting_approval';
      return;
    }
    case 'approval.resolved': {
      const call = open(callOf(s, e.callId));
      if (s.pendingApproval?.callId !== e.callId) fail(`no pending approval for ${e.callId}`);
      if (e.argsHash !== call.argsHash)
        fail(`approval for ${e.callId} doesn't match its arguments`);
      call.approval = { argsHash: e.argsHash, granted: e.granted, by: e.by };
      if (e.granted && e.always && !s.alwaysAllowed.includes(call.tool))
        s.alwaysAllowed.push(call.tool);
      s.pendingApproval = undefined;
      s.status = 'running';
      if (!e.granted) {
        setResult(s, call, {
          ok: false,
          error: e.note
            ? `The user declined this action and said: ${e.note}`
            : 'The user declined this action.',
          retryable: false,
          phase: 'before_effect',
        });
      }
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
      s.planGated = true;
      s.log.push({ kind: 'user', text: e.text });
      return;
    case 'task.cancel_requested':
      s.cancelRequested = true;
      return;
    case 'task.finished':
      s.status = e.status;
      s.final = { status: e.status, answer: e.answer, reason: e.reason };
      s.pendingApproval = undefined;
      s.pendingQuestion = undefined;
      s.pause = undefined;
      return;
  }
}

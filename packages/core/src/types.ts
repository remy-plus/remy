// The contract every Remy package builds on. See PLAN.md "Interfaces".
import type { z } from 'zod';

// ---------- Risk, effects, results ----------
export type Risk = 'read' | 'write' | 'send_as_user' | 'spend_money' | 'irreversible';
export const RISKS: readonly Risk[] = [
  'read',
  'write',
  'send_as_user',
  'spend_money',
  'irreversible',
];
/** Risks that always need a human, whatever the task's permissions say. */
export const HIGH_RISK: readonly Risk[] = ['send_as_user', 'spend_money', 'irreversible'];

export type Effect = 'none' | 'idempotent' | 'reconcilable' | 'unsafe_to_retry';
export type Trust = 'trusted' | 'untrusted';

export type ToolResult =
  | { ok: true; content: string; trust: Trust; data?: unknown }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      phase: 'before_effect' | 'after_effect' | 'unknown';
    };

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'require_approval'; reason: string }
  | { kind: 'deny'; reason: string };

// ---------- Task config ----------
export interface Budget {
  maxSteps: number;
  maxCostUsd: number;
  maxWallMs: number;
  maxCallsPerStep: number;
}

export interface Permissions {
  autoApprove: Risk[];
  allowTools?: string[];
  denyTools?: string[];
  netAllow?: string[];
}

export interface TaskConfig {
  model: string;
  permissions: Permissions;
  budget: Budget;
  workspaceDir: string;
  /** Earlier turns of the same conversation, oldest first. Rendered as prior messages; see `buildMessages`. */
  context?: ConversationTurn[];
  /**
   * Segments of the prompt the user pasted rather than typed. They are untrusted data: the task
   * starts tainted and `buildMessages` fences them. Absent in older event logs.
   */
  pasted?: string[];
}

export interface ConversationTurn {
  prompt: string;
  /** Pasted segments of `prompt`, fenced when the turn is replayed as context. */
  pasted?: string[];
  answer: string;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 30,
  maxCostUsd: 1,
  maxWallMs: 30 * 60_000,
  maxCallsPerStep: 4,
};

// ---------- Events ----------
export type TaskStatus =
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type FinalStatus = 'succeeded' | 'failed' | 'cancelled';

export interface PlannedCall {
  callId: string;
  tool: string;
  args: unknown;
  argsHash: string;
}

export interface Usage {
  inTokens: number;
  outTokens: number;
}

export type Event =
  | { type: 'task.created'; prompt: string; config: TaskConfig }
  | {
      type: 'model.responded';
      step: number;
      text?: string;
      calls: PlannedCall[];
      usage: Usage;
      costUsd: number;
      latencyMs: number;
    }
  | { type: 'model.failed'; step: number; error: string; retryable: boolean; attempt: number }
  | { type: 'policy.decided'; callId: string; decision: PolicyDecision }
  | {
      type: 'approval.requested';
      callId: string;
      argsHash: string;
      preview: string;
      risk: Risk;
      reason: string;
    }
  | {
      type: 'approval.resolved';
      callId: string;
      argsHash: string;
      granted: boolean;
      by: string;
      /** Why a call was denied, in the user's words. The model sees it as the tool result. */
      note?: string;
    }
  | { type: 'tool.started'; callId: string; idempotencyKey: string; attempt: number }
  | { type: 'tool.completed'; callId: string; result: ToolResult; latencyMs: number }
  /** One attempt failed and will be retried. The final outcome is always `tool.completed`. */
  | { type: 'tool.failed'; callId: string; error: string; retryable: boolean; attempt: number }
  | { type: 'tool.reconciled'; callId: string; outcome: 'already_done' | 'not_done' | 'unknown' }
  | { type: 'user.asked'; question: string; callId?: string }
  | { type: 'user.answered'; answer: string; pasted?: string[] }
  | { type: 'task.cancel_requested'; by: string }
  | { type: 'task.finished'; status: FinalStatus; answer?: string; reason?: string };

export type EventType = Event['type'];
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;

export interface StoredEvent {
  taskId: string;
  seq: number;
  at: string;
  event: Event;
}

// ---------- Persistence ----------
export interface Lease {
  taskId: string;
  owner: string;
  expiresAt: number;
}

export interface TaskSummary {
  taskId: string;
  status: TaskStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export class ConcurrencyError extends Error {
  override name = 'ConcurrencyError';
}

export interface EventStore {
  /** Creates the task and appends its `task.created` event as seq 1. */
  createTask(taskId: string, prompt: string, config: TaskConfig): Promise<void>;
  read(taskId: string, fromSeq?: number): Promise<StoredEvent[]>;
  /** Atomic. Throws ConcurrencyError if expectedSeq is stale or the lease isn't held. Returns the new last seq. */
  append(taskId: string, expectedSeq: number, events: Event[], lease: Lease): Promise<number>;
  acquireLease(taskId: string, owner: string, ttlMs: number): Promise<Lease | null>;
  renewLease(lease: Lease): Promise<boolean>;
  releaseLease(lease: Lease): Promise<void>;
  listTasks(filter?: { status?: TaskStatus }): Promise<TaskSummary[]>;
}

// ---------- Models ----------
export interface ModelCall {
  callId: string;
  tool: string;
  args: unknown;
}

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; calls?: ModelCall[] }
  | { role: 'tool'; callId: string; tool: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelCaps {
  nativeTools: boolean;
  jsonSchema: boolean;
  contextTokens: number;
  /** The real context window, when known. Unlike `contextTokens` it has no default, so UIs can omit a meter rather than guess. */
  contextWindow?: number;
  /** Tokens per minute the provider allows this key, when known (e.g. a free tier). Requests are sized to fit it. */
  tpm?: number;
  pricing: { inPerMTok: number; outPerMTok: number };
}

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  temperature: number;
}

export interface ModelResponse {
  text?: string;
  calls: { tool: string; args: unknown }[];
  usage: Usage;
}

export interface ModelClient {
  readonly id: string;
  readonly caps: ModelCaps;
  /**
   * `onText` receives assistant text as it arrives. The returned response is the same either way.
   * `onReasoning` receives reasoning summaries, only from providers that stream them; it is never
   * part of the response and never stored.
   */
  complete(
    req: ModelRequest,
    signal: AbortSignal,
    onText?: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ): Promise<ModelResponse>;
}

/** Thrown by model clients. `retryable` covers network errors, 429, 5xx and timeouts. */
export class ModelError extends Error {
  override name = 'ModelError';
  readonly retryable: boolean;
  /** The provider said "too many requests"; worth waiting longer than a glitch. */
  readonly rateLimited: boolean;
  /** How long the provider asked us to wait, when it said. */
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    retryable: boolean,
    rate?: { rateLimited: true; retryAfterMs?: number },
  ) {
    super(message);
    this.retryable = retryable;
    this.rateLimited = rate?.rateLimited ?? false;
    if (rate?.retryAfterMs !== undefined) this.retryAfterMs = rate.retryAfterMs;
  }
}

// ---------- Tools ----------
export interface ScopedFs {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  list(path: string): Promise<{ name: string; dir: boolean }[]>;
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface ScopedFetch {
  get(url: string, opts?: { signal?: AbortSignal }): Promise<FetchResult>;
}

export interface SecretReader {
  get(name: string): string | undefined;
}

export interface Clock {
  now(): number;
}

export interface IdGen {
  next(prefix: string): string;
}

export interface ToolContext {
  taskId: string;
  callId: string;
  idempotencyKey: string;
  signal: AbortSignal;
  fs: ScopedFs;
  net: ScopedFetch;
  secrets: SecretReader;
  clock: Clock;
}

export interface Tool<A = unknown> {
  name: string;
  description: string;
  args: z.ZodType<A>;
  risk: Risk;
  effect: Effect;
  outputTrust: Trust;
  timeoutMs: number;
  maxOutputChars: number;
  preview(args: A): string;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
  reconcile?(
    args: A,
    ctx: ToolContext,
  ): Promise<{ done: true; result: ToolResult } | { done: false }>;
}

// ---------- Runtime API ----------
export interface ApprovalRequest {
  callId: string;
  argsHash: string;
  preview: string;
  risk: Risk;
  reason: string;
}

export type RunOutcome =
  | { status: 'waiting_approval'; request: ApprovalRequest }
  | { status: 'waiting_user'; question: string }
  | { status: FinalStatus; answer?: string; reason?: string };

export interface Runtime {
  start(prompt: string, config: TaskConfig): Promise<string>;
  advance(taskId: string): Promise<RunOutcome>;
  approve(
    taskId: string,
    callId: string,
    argsHash: string,
    granted: boolean,
    by: string,
    /** With a denial: guidance the model reads as the tool result. Ignored when granted. */
    note?: string,
  ): Promise<void>;
  /** `pasted`: segments of the answer the user pasted. They are untrusted and taint the task. */
  answer(taskId: string, answer: string, pasted?: string[]): Promise<void>;
  cancel(taskId: string, by: string): Promise<void>;
}

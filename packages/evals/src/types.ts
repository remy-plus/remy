import type { Budget, EventType, ModelClient, Risk, TaskStatus } from '@remy/core';

export type Suite = 'research' | 'files' | 'approval' | 'injection' | 'recovery';
export const SUITES: readonly Suite[] = ['research', 'files', 'approval', 'injection', 'recovery'];

export interface MockEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export interface SentEmail {
  key: string;
  to: string;
  subject: string;
  body: string;
}

/** One model step in a reference plan: tool calls, or plain text (a final answer). */
export type Move = { tool: string; args: unknown }[] | string;

export type Fault =
  | { kind: 'crash'; when: 'before' | 'after'; event: EventType; tool?: string }
  | { kind: 'transient'; tool: string; times: number };

export interface Human {
  /** A record lists decisions per tool; tools it doesn't mention are declined. */
  approvals: 'grant_all' | 'deny_all' | Record<string, boolean>;
  answers?: string[];
}

export interface EvalCase {
  id: string;
  suite: Suite;
  prompt: string;
  world: { web?: Record<string, string>; files?: Record<string, string>; inbox?: MockEmail[] };
  /** Tools the model may use. Defaults to the ones the world makes useful, plus finish and ask_user. */
  tools?: string[];
  human: Human;
  faults?: Fault[];
  graders: Grader[];
  budget?: Partial<Budget>;
  /** The ideal plan, played by the `reference` model. */
  reference: Move[];
  /** For injection cases: the call a gullible model would make. Tests splice it into the plan. */
  attack?: Move;
}

// ---------- Records ----------
export type FailureCategory =
  | 'schema_invalid'
  | 'budget'
  | 'loop'
  | 'tool_error'
  | 'wrong_answer'
  | 'model_error';

export interface ToolCallRecord {
  callId: string;
  tool: string;
  args: unknown;
  started: boolean;
  /** Whether a human approved these exact arguments. Undefined when no approval was asked. */
  approved?: boolean;
  outcome: 'ok' | 'error' | 'denied' | 'declined' | 'none';
}

export interface ApprovalRecord {
  callId: string;
  tool: string;
  risk: Risk;
  reason: string;
  granted?: boolean;
}

export interface Grade {
  name: string;
  pass: boolean;
  detail: string;
  safety: boolean;
}

export interface RunRecord {
  caseId: string;
  suite: Suite;
  run: number;
  status: TaskStatus;
  answer?: string;
  reason?: string;
  steps: number;
  modelCalls: number;
  tokens: { in: number; out: number };
  costUsd: number;
  wallMs: number;
  modelLatencyMs: number;
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRecord[];
  crashes: number;
  /** Tools that started without an approval they needed, or after a denial. */
  policyViolations: string[];
  /** Side effects executed more than once under the same idempotency key. */
  duplicateEffects: number;
  grades: Grade[];
  pass: boolean;
  safetyViolations: number;
  failure?: FailureCategory;
  error?: string;
}

export interface WorldAfter {
  files: Record<string, string>;
  /** Every email_send execution, duplicates included. */
  emails: SentEmail[];
}

export interface GradeResult {
  pass: boolean;
  detail: string;
}

export interface Grader {
  name: string;
  /** A failing safety grader counts as a safety violation. */
  safety?: boolean;
  check(run: RunRecord, world: WorldAfter): GradeResult | Promise<GradeResult>;
}

export type ModelFor = (c: EvalCase) => ModelClient;

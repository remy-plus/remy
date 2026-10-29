import type {
  Budget,
  ConversationTurn,
  EventType,
  ModelClient,
  Risk,
  TaskStatus,
} from '@remy/core';
import type { MemoryKind } from '@remy/tools';

export type Suite =
  | 'research'
  | 'files'
  | 'approval'
  | 'injection'
  | 'recovery'
  | 'connections'
  | 'memory';
export const SUITES: readonly Suite[] = [
  'research',
  'files',
  'approval',
  'injection',
  'recovery',
  'connections',
  'memory',
];

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

/** One tool of a fake MCP server. Every parameter is a required string. */
export interface McpToolSpec {
  name: string;
  description: string;
  /** What the server claims. Remy believes `readOnlyHint` only when the server has `trustHints`. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  /** Parameter name to description. */
  params?: Record<string, string>;
  /** What the server answers. Default: the `output` text (or "ok"). */
  result?: {
    output?: string;
    /** An `isError` result: the server ran the tool and says it failed. */
    isError?: boolean;
    /** The server process dies while the call is running: no reply ever arrives. */
    dies?: boolean;
  };
}

/** A fake MCP server run in-process, reached through the real MCP client and adapter. */
export interface McpServerSpec {
  name: string;
  /** The user's config says to believe this server's `readOnlyHint`s. Off for a hand-added server. */
  trustHints?: boolean;
  tools: McpToolSpec[];
  /** The sign-in expires right after the tools are listed: every later call is refused (a 401). */
  signsOutAfterListing?: boolean;
}

export interface EvalCase {
  id: string;
  suite: Suite;
  prompt: string;
  world: {
    web?: Record<string, string>;
    files?: Record<string, string>;
    inbox?: MockEmail[];
    /** Fake MCP servers. Their tools are named `<server>__<tool>` and allowed automatically. */
    mcp?: McpServerSpec[];
    /**
     * Notes already saved about the user. Present (even empty) means personalising is on: the task
     * has `remember` and `forget` and the most relevant notes are in its system prompt.
     */
    memory?: { text: string; kind?: MemoryKind }[];
    /** Past tasks of the user, for `recall` (needs `memory`). `tainted`: it read untrusted content. */
    history?: { prompt: string; answer: string; date?: string; tainted?: boolean }[];
  };
  /** Tools the model may use. Defaults to the ones the world makes useful, plus finish and ask_user. */
  tools?: string[];
  human: Human;
  /** Segments of `prompt` the user pasted: untrusted, like a chat paste. */
  pasted?: string[];
  /** Earlier turns of the chat (a leading `summary` turn too), as the chat would send them. */
  context?: ConversationTurn[];
  /** Risks the user pre-approved. Defaults to read only. */
  autoApprove?: Risk[];
  /** Tool names with a standing approval ("always allow"). */
  standing?: string[];
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
  tokens: { in: number; out: number; cached?: number };
  costUsd: number;
  wallMs: number;
  modelLatencyMs: number;
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRecord[];
  crashes: number;
  /** For cases with MCP servers: the MCP tool names offered to the model on each request, in order. */
  offered?: string[][];
  /**
   * For runs with more than one model request: how much of each previous request the next one
   * starts with again (`shared`), out of the previous requests' length (`total`). A request that only
   * appends scores ~100%; anything lower is a change a provider's prompt cache cannot reuse.
   */
  prefix?: { shared: number; total: number };
  /** Extra chat turns after the first task, when the agent ended by asking a question. */
  followUps?: number;
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
  /** Every call that reached a fake MCP server, as the server saw it (tool name without the server prefix). */
  mcpCalls: { server: string; tool: string; args: Record<string, unknown> }[];
  /** The saved notes at the end of the run. */
  memory: { id: string; text: string; kind: MemoryKind; source: string }[];
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

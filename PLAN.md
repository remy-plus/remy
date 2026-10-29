# Remy: Plan v2

## Context

Remy is a universal AI agent: one chat box that gets real digital work done for anyone. The long-term aim is AGI/ASI; the near-term aim is a capable, **reliable** agent that is stupidly simple to use.

v1 (2026-10-23) set the target architecture. v2 reworks it around five priorities:

1. **Smallest complete runtime first:** Phase 0 has no infrastructure it doesn't need.
2. **Durable tasks:** persistence, crash recovery, retries, and no duplicate actions.
3. **Security enforced in code**, not in prompts: tool permissions, prompt injection, approvals.
4. **Evals from day one:** success, reliability, cost, latency, regressions.
5. **Modularity:** new capabilities plug in without rebuilding.

**Fixed decisions:** web app + PWA is the first real surface (Phase 1). Execution routes in order of preference: API/MCP → cloud browser → user's device. TypeScript end to end. Users choose their own model; testing uses cheap or free open-weight models. Scope is "everything", but each domain ships only once its evals pass.

---

## Core design rules

These rules apply to every phase. Each one names the mechanism that enforces it.

| Rule | Enforced by |
|---|---|
| Every state change is an append-only event; state = `fold(events)` | `EventStore.append` is the only write path; the reducer is pure |
| The runner never asks "where was I?" It computes `nextAction(state)` | Crash recovery is just: re-read the events, call `nextAction` again |
| No tool runs without a policy decision | The executor only accepts `AuthorizedCall`, a branded type only the policy module can create |
| An approval covers *exact* arguments, once | Approvals bind to `argsHash` (a hash of the canonical JSON arguments) and are single-use |
| No side effect is retried blindly | Each tool declares `effect`; recovery logic branches on it |
| Untrusted content can't trigger risky actions on its own | Taint flag on the task state; policy rule, not prompt text |
| Core depends on interfaces, never on vendors | Ports (interfaces) in `core`; adapters in their own packages |
| Every run is measurable | Events record tokens, cost, and timing; evals read the same events |

---

## Target architecture (unchanged in shape; Phase 0 builds the core)

```
 Surfaces:  CLI (P0) · PWA (P1) · voice (P4) · desktop companion (P4)
               │   all talk to the runtime through the same API: start / advance / approve / answer / cancel
 Runtime:   Runner ── nextAction(state) ── Policy ── ToolExecutor ── ModelClient
               │
 Ports:     EventStore · ModelClient · Tool · SecretStore · Clock · IdGen
 Adapters:  SQLite (P0) → Postgres (P1) · OpenAI-compatible client (P0) → more providers
            built-in tools (P0) → MCP integrations (P2) → cloud browser (P3) → device agent (P4)
```

Phase 1 swaps SQLite for Postgres and adds a server + PWA + worker pool *behind the same interfaces*. Nothing in `core` changes.

---

## Phase 0: the smallest complete agent runtime

### Scope

**In:** a CLI agent that runs a task to completion with real models, survives `kill -9` without duplicate actions, enforces permissions and approvals in code, and is measured by a 30-case eval suite.

**Out (deliberately):** web UI, HTTP server, Postgres, job queues, Docker, Turborepo, Langfuse, code execution, MCP, browser automation, long-term memory, auth/multi-user, context summarization (Phase 0 truncates tool output only). The event log *is* the trace; `remy show` and a JSONL export replace a tracing service for now.

### Tech (minimal deps)

Node 22.18+, TypeScript `strict`, pnpm workspaces, `zod` v4 (tool schemas → JSON Schema), built-in `node:sqlite` (no native deps), `vitest`, Biome (lint and format). Node runs the TypeScript sources directly (type stripping, `--conditions=@remy/source`), so there is no `tsx`. The CLI uses `node:util` `parseArgs` (no framework).

**Model client:** a thin, fetch-based **OpenAI-compatible** client written in-house (about 200 lines). One adapter covers OpenRouter, Ollama, LM Studio, vLLM, Groq, Together, and OpenAI. *Why not the Vercel AI SDK yet:* we need byte-level control for the weak-model JSON fallback, for record/replay, and for exact cost accounting. The SDK can sit behind `ModelClient` later if a provider's native features are worth it.

### Packages

```
remy/
  packages/core     types, events, reducer, nextAction, runner, policy, budgets, retry
  packages/models   OpenAI-compatible client, tool-calling strategies, pricing, record/replay
  packages/tools    built-in tools, ScopedFs, ScopedFetch, secret redaction
  packages/store    EventStore: in-memory (tests) + SQLite
  packages/evals    case format, mock world, graders, eval runner, compare
  apps/cli          remy run | resume | approve | show | cancel | eval
```

Dependency rule: `core` imports nothing from the others. Everything else depends on `core`'s interfaces.

### Interfaces

```ts
// ---------- Events (the single source of truth) ----------
type TaskStatus = 'running' | 'waiting_approval' | 'waiting_user'
                | 'succeeded' | 'failed' | 'cancelled';

type Event =
  | { type: 'task.created'; prompt: string; config: TaskConfig }
  | { type: 'model.responded'; step: number; text?: string; calls: PlannedCall[];
      usage: { inTokens: number; outTokens: number }; costUsd: number; latencyMs: number }
  | { type: 'model.failed'; step: number; error: string; retryable: boolean; attempt: number }
  | { type: 'policy.decided'; callId: string; decision: PolicyDecision }
  | { type: 'approval.requested'; callId: string; argsHash: string; preview: string; risk: Risk; reason: string }
  | { type: 'approval.resolved'; callId: string; argsHash: string; granted: boolean; by: string }
  | { type: 'tool.started'; callId: string; idempotencyKey: string; attempt: number }
  | { type: 'tool.completed'; callId: string; result: ToolResult; latencyMs: number }
  | { type: 'tool.failed'; callId: string; error: string; retryable: boolean; attempt: number }
  | { type: 'tool.reconciled'; callId: string; outcome: 'already_done' | 'not_done' | 'unknown' }
  | { type: 'user.asked'; question: string }
  | { type: 'user.answered'; answer: string }
  | { type: 'task.cancel_requested'; by: string }
  | { type: 'task.finished'; status: 'succeeded' | 'failed' | 'cancelled'; answer?: string; reason?: string };

interface PlannedCall { callId: string; tool: string; args: unknown; argsHash: string } // callId assigned & persisted at model.responded
interface StoredEvent { taskId: string; seq: number; at: string; event: Event }

// ---------- Persistence ----------
interface EventStore {
  createTask(taskId: string, prompt: string, config: TaskConfig): Promise<void>;
  read(taskId: string, fromSeq?: number): Promise<StoredEvent[]>;
  /** Atomic. Fails with ConcurrencyError if expectedSeq is stale or the lease isn't held. */
  append(taskId: string, expectedSeq: number, events: Event[], lease: Lease): Promise<number>;
  acquireLease(taskId: string, owner: string, ttlMs: number): Promise<Lease | null>;
  renewLease(lease: Lease): Promise<boolean>;
  releaseLease(lease: Lease): Promise<void>;
  listTasks(filter?: { status?: TaskStatus }): Promise<TaskSummary[]>;
}

// ---------- Models ----------
interface ModelClient {
  readonly id: string;
  readonly caps: { nativeTools: boolean; jsonSchema: boolean; contextTokens: number;
                   pricing: { inPerMTok: number; outPerMTok: number } };
  complete(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
interface ModelRequest { system: string; messages: Message[]; tools: ToolSpec[]; maxOutputTokens: number; temperature: number }
interface ModelResponse { text?: string; calls: { tool: string; args: unknown }[]; usage: { inTokens: number; outTokens: number } }
// Strategies wrap a raw client: NativeToolStrategy | JsonToolStrategy (for weak models)

// ---------- Tools ----------
type Risk   = 'read' | 'write' | 'send_as_user' | 'spend_money' | 'irreversible';
type Effect = 'none'              // pure/read-only: safe to re-run
            | 'idempotent'        // same key → same outcome (overwrite file, API with idempotency key)
            | 'reconcilable'      // can check afterwards whether it happened
            | 'unsafe_to_retry';  // can't know: ask the human

interface Tool<A = unknown> {
  name: string; description: string; args: z.ZodType<A>;
  risk: Risk; effect: Effect;
  outputTrust: 'trusted' | 'untrusted';
  timeoutMs: number; maxOutputChars: number;
  preview(args: A): string;                                   // plain-English text for the approval card
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
  reconcile?(args: A, ctx: ToolContext): Promise<{ done: true; result: ToolResult } | { done: false }>;
}
interface ToolContext {
  taskId: string; callId: string; idempotencyKey: string; signal: AbortSignal;
  fs: ScopedFs;        // jailed to the task workspace
  net: ScopedFetch;    // SSRF-guarded, allowlist-capable, size/time limited
  secrets: SecretReader; clock: Clock;
}
type ToolResult =
  | { ok: true; content: string; trust: 'trusted' | 'untrusted'; data?: unknown }
  | { ok: false; error: string; retryable: boolean; phase: 'before_effect' | 'after_effect' | 'unknown' };

// ---------- Policy ----------
type PolicyDecision = { kind: 'allow' } | { kind: 'require_approval'; reason: string } | { kind: 'deny'; reason: string };
declare const authorized: unique symbol;
type AuthorizedCall = PlannedCall & { readonly [authorized]: true };   // only policy.ts can mint this
interface Policy { decide(call: PlannedCall, tool: Tool, state: TaskState): PolicyDecision }
interface ToolExecutor { run(call: AuthorizedCall, ctx: ToolContext): Promise<ToolResult> }

// ---------- Task config, budgets, runner API ----------
interface TaskConfig {
  model: string;
  permissions: { autoApprove: Risk[]; allowTools?: string[]; denyTools?: string[]; netAllow?: string[] };
  budget: { maxSteps: number; maxCostUsd: number; maxWallMs: number; maxCallsPerStep: number };
  workspaceDir: string;
}
type RunOutcome =
  | { status: 'waiting_approval'; request: { callId: string; argsHash: string; preview: string; risk: Risk; reason: string } }
  | { status: 'waiting_user'; question: string }
  | { status: 'succeeded' | 'failed' | 'cancelled'; answer?: string; reason?: string };

interface Runtime {                      // the same API the PWA will use in Phase 1
  start(prompt: string, config: TaskConfig): Promise<string>;            // returns taskId
  advance(taskId: string): Promise<RunOutcome>;                          // runs until it pauses or finishes
  approve(taskId: string, callId: string, argsHash: string, granted: boolean, by: string): Promise<void>;
  answer(taskId: string, answer: string): Promise<void>;
  cancel(taskId: string, by: string): Promise<void>;
}
```

### The runner: `nextAction(state)`

`advance()` acquires the lease, folds the events into `TaskState`, then loops:

```
action = nextAction(state)                       // pure function, unit-tested exhaustively
  'finish'          → append task.finished
  'pause'           → return waiting_approval / waiting_user (release lease)
  'call_model'      → check budget → model call (retry if transient) → append model.responded
  'decide'(call)    → policy.decide → append policy.decided (+ approval.requested if needed)
  'execute'(call)   → append tool.started (WRITE-AHEAD) → run → append tool.completed | tool.failed
  'recover'(call)   → started-but-unfinished call found after a crash → see below
after each append: state = reduce(state, events); renew the lease; check cancel/budget/loop detection
```

Because every decision comes from the persisted state, a crash at *any* point resumes correctly. Approvals pause the task durably: the process can exit, and `remy approve` + `remy resume` continues later (exactly how the PWA will work).

### Persistence, recovery, retries, duplicate protection

**Storage (SQLite via `node:sqlite`, WAL mode):** leases are 15s and renewed by a heartbeat during long calls, so a killed runner's task frees up quickly.
- `tasks(id PK, status, prompt, config_json, created_at, updated_at, lease_owner, lease_expires_at)`
- `events(task_id, seq, at, type, payload_json, PRIMARY KEY(task_id, seq))`
- `append` runs in one transaction: check the lease is held and unexpired, check `max(seq) == expectedSeq`, insert the events, update the cached `tasks.status`. A stale writer gets `ConcurrencyError` and stops. The lease plus the sequence check means two runners can never both act on one task (that matters once Phase 1 adds worker pools).

**Idempotency key:** `${taskId}:${callId}`. `callId` is generated once, when `model.responded` is persisted, so a replay produces the same key. Tools pass it to external APIs where supported.

**Recovery of a call that has `tool.started` but no result, by `effect`:**

| effect | action |
|---|---|
| `none` | re-run |
| `idempotent` | re-run with the same idempotency key |
| `reconcilable` | `reconcile()` → `already_done` (record the result, no re-run) / `not_done` (re-run) / error → treat as `unsafe_to_retry` |
| `unsafe_to_retry` | **never re-run.** Pause with `waiting_user`: "I may already have done X. Check, then tell me to retry or skip." |

**A recorded model response is never re-requested.** On resume it is reused, so the model can't "change its mind" about a call that is already half done.

**Retries** (one `retry()` helper: exponential backoff 0.5s→8s with jitter, max 3 attempts, every attempt logged as an event):
- Model calls: retry on network errors, 429, 5xx, timeouts. Invalid tool-call output → repair retry ≤2 (the error is fed back), then mark the step failed.
- Tools: auto-retry only if `effect ∈ {none, idempotent}` **or** the failure reports `phase: 'before_effect'`. Otherwise the error goes back to the model as a tool result.
- Permanent errors (validation, 4xx, denied) are never retried. The model sees them and adapts.

**Budgets and loop detection** (enforced by the runner, not the model): `maxSteps`, `maxCostUsd`, `maxWallMs`, `maxCallsPerStep`. The same `tool + argsHash` 3 times in one task → stop (the task fails with a plain reason). Cancellation is checked between actions, and an `AbortSignal` is passed to model and tool calls.

### Security enforced in code

**Policy rules** (`core/policy.ts`, evaluated in order, table-tested):
1. Unknown tool, or args fail the zod schema → `deny` (the error is shown to the model).
2. Tool is in `denyTools`, or not in `allowTools` when that list is set → `deny`.
3. `risk ∈ {send_as_user, spend_money, irreversible}` → `require_approval`, **always** (no standing grants in Phase 0).
4. **Task is tainted** and `risk !== 'read'` → `require_approval`, even when `autoApprove` includes that risk.
5. `risk ∈ autoApprove` (default `['read']`) → `allow`; otherwise → `require_approval`.

**Enforcement properties:**
- `ToolExecutor.run` accepts only `AuthorizedCall`. A lint rule plus a test block any other module from constructing the brand.
- An approval is valid only if `approval.resolved.argsHash === call.argsHash` and it hasn't been used. If the model changes the arguments, the approval no longer applies.
- **Taint:** any `ToolResult` with `trust: 'untrusted'` (web pages, search results, email, files from outside) sets `state.tainted = true` for the rest of the task. Untrusted content is also wrapped in `<untrusted source="…">` delimiters in context, but that is defense in depth. **The rule that blocks attacks is #4, not the wrapper.**
- **Capabilities, not globals:** tools get `ScopedFs` (realpath-checked jail to `workspaceDir`, blocks symlink escapes, size limits) and `ScopedFetch` (http/https only, blocks private/loopback/link-local IPs including after DNS resolution and redirects, optional domain allowlist, response size and time caps). Tools never import `fs` or `fetch` directly; a lint rule enforces this inside `packages/tools`.
- **Secrets:** read through `SecretReader`, never placed in model context. A redaction pass strips known secret values from tool output before it reaches the model or the event log.
- **Approval UX:** `preview()` gives plain-English text ("Send an email to bob@x.com with subject 'Invoice'"). The CLI also shows the risk level and *why* approval is needed (e.g. "this task read untrusted web content").

**Known gap (tracked):** read-only tools can still leak data (e.g. a `fetch_url` whose query string carries private data). Phase 0 mitigation: no secrets in context, plus an optional `netAllow`. Phase 2 adds checks on where arguments came from (argument provenance).

### Phase 0 built-in tools

| Tool | risk | effect | output trust |
|---|---|---|---|
| `read_file`, `list_files` | read | none | trusted (workspace) |
| `write_file` | write | idempotent (overwrite) | — |
| `fetch_url` (HTML → readable text) | read | none | untrusted |
| `web_search` (provider adapter: Brave/Tavily/SearXNG; mock in evals) | read | none | untrusted |
| `ask_user` | read | none | trusted (pauses the task) |
| `finish` (explicit final answer, which helps weak models terminate) | read | none | — |
| *eval-only:* `email_read`, `email_send` (mock inbox) | read / send_as_user | none / reconcilable | untrusted / — |

The mock `email_send` exists so approvals, injection defense, and duplicate protection are testable in Phase 0. It is also the template for real Gmail in Phase 2.

### Weak-model support

- `NativeToolStrategy` for models with dependable tool calling. `JsonToolStrategy` for the rest: the tools are described in the system prompt, the model must output exactly one `{"tool": …, "args": …}` per step, `response_format: json_schema` is used when supported (else `json_object`), the output is validated with zod, and a repair retry ≤2 feeds back the exact error.
- Model capabilities and pricing come from `models.json` (user-editable; free models cost 0). Tool output is truncated to `maxOutputChars`, with the full output kept in the event.
- Config: `remy.config.json` or env vars `REMY_BASE_URL`, `REMY_API_KEY`, `REMY_MODEL`, with ready-made profiles for `openrouter` and `ollama`.

### Evals from day one

```ts
interface EvalCase {
  id: string;
  suite: 'research' | 'files' | 'approval' | 'injection' | 'recovery' | 'connections';
  prompt: string;
  world: { web?: Record<string, string>; files?: Record<string, string>; inbox?: MockEmail[]; mcp?: McpServerSpec[] };
  tools?: string[];
  human: { approvals: 'grant_all' | 'deny_all' | Record<string, boolean>; answers?: string[] };  // scripted human
  faults?: Fault[];   // { kind: 'crash_after', event: 'tool.started', tool: 'email_send' } | { kind: 'transient', tool: 'fetch_url', times: 2 } | ...
  graders: Grader[];
  budget?: Partial<TaskConfig['budget']>;
}
type Grader = (run: RunRecord, world: WorldAfter) => { pass: boolean; detail: string };
```

- **Graders, in order of preference:** checks on the final world state (`emailsSent.length === 1`, file contents) → checks on the answer (contains, regex, JSON fields) → checks on the trajectory (`neverCalled`, `onlyWithApproval`, `noPolicyViolations`, `maxSteps`) → `llmJudge(rubric)` only when nothing deterministic fits.
- **Mock world:** `ScopedFetch` and the tools are swapped for fixture-backed versions, so runs are deterministic and free to repeat.
- **Faults:** the eval runner wraps the store and tools to simulate crashes (it throws after a chosen event and then calls `advance()` again on a fresh runtime) and transient failures.
- **The 30 starting cases:** 10 research/QA over a mock web · 6 file tasks · 5 approval flows (grant, deny, changed args invalidate the approval, ask_user) · 5 prompt injections (instructions hidden in pages and emails try to make Remy send email or write files) · 4 recovery (crash after `tool.started` on a reconcilable send → exactly 1 email sent; crash after `model.responded` → no second model call; transient fetch ×2 → succeeds; crash during an idempotent write → correct file).
- **The suite today: 53 cases** (the 30 above grew to 36 in V1: 12 research · 8 files · 6 approval · 6 injection · 4 recovery; 0.5 added the 17-case `connections` suite, below).
- **Metrics per run:** success rate; **pass^k** (all k repeats pass, the reliability number); **safety violations** and **duplicate side effects**, both of which must be 0; steps; tokens in/out; cost USD; task wall time p50/p95; model latency; failure categories (schema invalid, budget, loop, tool error, wrong answer).
- **Output:** `evals/results/<date>-<model>.json` plus a markdown summary. `remy eval compare base.json new.json` exits non-zero on a **regression**: any safety or duplicate failure, a success drop of more than 5 points on any suite, or cost or p95 latency up more than 25%.
- **Record/replay:** `RecordingModelClient` saves responses keyed by request hash; `ReplayModelClient` makes CI runs free and deterministic. Runtime unit tests use `ScriptedModelClient`.
- **Commands:** `pnpm eval --model <id> [--suite s] [--k 3]`, `pnpm eval:replay`, `pnpm eval compare`.

### Implementation order (each step ends green before the next starts)

| # | Step | Done when |
|---|---|---|
| 1 | Scaffold: pnpm workspaces, TS strict, Biome, vitest, package boundaries | `pnpm build && pnpm test` pass on the empty packages; `core` has no imports from other packages |
| 2 | `core`: Event types, `TaskState`, `reduce`, status state machine | Tests cover every event, and invalid transitions throw |
| 3 | `store`: in-memory + SQLite `EventStore`, leases, optimistic append | Concurrency tests: a stale `expectedSeq` and an expired lease both reject; two racing writers → one wins |
| 4 | `core`: `Tool` interface, registry, zod → JSON Schema, `ScopedFs` + `read_file`, `write_file`, `list_files`, `finish` | Jail tests: `../`, absolute paths, and symlink escapes are all rejected |
| 5 | `core`: Policy + `AuthorizedCall` + approval binding + taint | A test table covers all 5 rules × taint × autoApprove; changed args → approval rejected; brand can't be forged (lint + test) |
| 6 | `models`: OpenAI-compatible client, Native/Json strategies, pricing, Scripted/Recording/Replay clients | Live smoke test against Ollama and OpenRouter; JSON repair-retry tests |
| 7 | `core`: `nextAction`, runner, budgets, retry, loop detection, write-ahead, recovery by effect type | Scripted-model tests: a crash injected at every event boundary resumes correctly with zero duplicate effects |
| 8 | `tools`: `ScopedFetch` (SSRF guard), `fetch_url`, `web_search`, `ask_user`, redaction | SSRF tests: localhost, 10.x, 169.254.x, and a DNS name that resolves to a private IP are all blocked |
| 9 | `apps/cli`: `run`, `resume`, `approve`, `show` (readable timeline), `cancel`, model profiles | Manual: `kill -9` during a task, then `remy resume` finishes it; the approval prompt shows preview + reason |
| 10 | `evals`: case format, mock world + mock email tools, graders, faults, metrics, compare, 30 cases | `pnpm eval:replay` is deterministic; `compare` flags a seeded regression |
| 11 | Baselines: 1 frontier model + 2–3 open-weight models, results committed | Baseline JSON + summary in `evals/results/`; `PLAN.md` status updated |

### Build workflow (who writes what)

The "Done when" checks (tests, `tsc`, Biome, the boundary check) are the monitor. Opus writes the subtle parts and the tests that define the hard parts. Cheaper models implement against those tests, and nobody pays a model to watch diffs.

| Steps | Writer | Why |
|---|---|---|
| 1, 2 (scaffold, events, reducer) | Opus | These types are the contract every package builds on |
| 5, 7 (policy and approvals, runner and recovery) | Opus | Small but security- and correctness-critical |
| Test files for 3, 4, 8 | Opus | The tests are the spec |
| 3, 4, 6, 8 (store, ScopedFs and file tools, model client, ScopedFetch) | Sonnet, in parallel git worktrees, until the Opus-written tests pass | Well specified; independent once step 2 is fixed |
| Review of 4 and 8 (jail, SSRF guard) | Opus, one pass | Security code |
| 9, 10 (CLI, eval harness) | Sonnet | Straightforward |
| Eval fixtures (mock pages, inboxes, injection payloads) | Haiku drafts, Sonnet checks | Lots of repetitive content |

Order: 1 → 2 → (3, 4, 6, 8 in parallel) → 5 → 7 → 9 → 10 → 11. Haiku never writes runtime code.

### Step 11 follow-up: weak-model reliability (2026-10-25)

GPT-5 nano runs 2 and 3 scored 97% and 92% (after grader fixes). The swing is model variance at k=3, but the failures repeat in three shapes, and each one has a fix in code or tool design, not in the model:

| Failure | Fix | Where |
|---|---|---|
| Repeats a call that already succeeded until loop detection fails the task | Policy denies an exact repeat (same tool + argsHash) of a call that already succeeded, with a reason telling the model to use the earlier result. A failed call can still be retried. Loop detection still stops the task at 3. | `core/policy.ts` |
| Summarizes an inbox from subject lines without opening the emails | The listing says it shows subjects only and that each email must be read by id; the system prompt says to open items before summarizing them | eval `email_read`, `core/messages.ts` |
| Asks the user in plain text (a list), which ends the task | System prompt: a reply without a tool call ends the task; questions go through ask_user | `core/messages.ts` |
| Live runs are too noisy to compare at k=3 | Use `--k 5` for live baselines; the deterministic replay stays the CI gate | process |

Done when: `pnpm check` and the replay eval stay green, and a GPT-5 nano run at k=5 has 0 safety violations, 0 duplicates and higher success than run 3.

### Phase 0 exit criteria

- All unit tests pass, including the policy table, the store concurrency tests, and crash-at-every-boundary recovery.
- **Safety and recovery suites: 100% on every model tested.** They are enforced by code, so they must not depend on model quality.
- Task suites (research + files): ≥70% success on the frontier model; measured baseline (success, pass^3, cost, latency) for 2–3 open-weight models.
- A full task can be run, killed, approved, resumed, and inspected from the CLI alone.

---

## V1: the terminal release (decided 2026-10-25)

V1 is a polished terminal app, tracked item by item in `V1.md`. The web app and PWA move to after V1. Phase 1 infrastructure (Postgres, Hono, worker pool) stays on the roadmap and is not needed for V1.

Work packages, in order. Sonnet writes the code, Opus reviews and merges, and `pnpm check` plus `pnpm eval:replay` must be green after each:

1. **Tools** (`packages/tools`):
   - `calculate`: arithmetic and date math.
   - `edit_file`: exact replace.
   - `move_file`, `delete_file`, `make_dir`.
   - `update_plan`: a visible step list.
   - `run_command`: an allowlisted program run with `execFile`, no shell, cwd in the workspace, scrubbed env, a timeout and an output cap. Its risk is `irreversible`, so it always needs approval.
2. **Streaming and conversations** (`packages/models`, `packages/core`):
   - `ModelClient.complete` takes an optional text-delta callback, and the OpenAI client parses SSE.
   - The runtime forwards deltas without persisting them.
   - A task can carry earlier turns (prompt and answer) as context, so a chat is a chain of tasks.
3. **Ink UI** (`apps/cli`). Plain `remy` opens a chat with:
   - the wordmark;
   - streaming replies;
   - a thinking indicator;
   - live tool and plan status;
   - inline approvals and questions;
   - shortcuts (Ctrl+C interrupts, Ctrl+D quits, Esc clears);
   - resize handling;
   - reduced-motion and limited-color modes;
   - a `--debug` log.

   The existing subcommands stay for scripts.
4. **Release**:
   - a publishable `remy` bin;
   - `CAPABILITIES.md` (what works and what does not);
   - README;
   - a live smoke test on real tasks (run by the user);
   - version 0.1.0.

   npm publish and the GitHub release need the user's go.

## 0.3: connect to almost any model (decided 2026-10-27)

1. **`remy login`**: a picker to choose a provider, paste a key (masked), check it with one request, and save it to the macOS Keychain (else a 0600 file in REMY_HOME). Order: flags > env > saved login > config. Keys never reach logs, events or the model.
2. **More providers**: one adapter over a unified LLM library (Pi's `pi-ai` or the Vercel AI SDK, chosen on native Anthropic and Gemini support, tools, streaming, size and license) for APIs that are not OpenAI-compatible. The thin OpenAI-compatible client stays for the rest.
3. **Subscription sign-in** (Claude, ChatGPT, Copilot, Gemini) only where the provider's terms allow third-party apps. Research in `design/research/subscription-login.md` decides; nothing is built that would put users' accounts at risk.

## 0.3: full-screen terminal (decided 2026-10-27)

Owner verdict on 0.2: "not as smooth as OpenCode"; wants centered, clean, structured, every element useful. Specs: `design/research/engineering/opencode-layout.md`. We take OpenCode's structure, not its look: Remy's palette, voice and calm stay.

**Architecture.** Stay on Ink 8 (Node 22+, no native binary, tests carry over); OpenTUI 0.7 needs Node 26.4+, is pre-1.0 and means a rewrite. Ink 8 gives `alternateScreen`, `incrementalRendering`, `maxFps`, absolute positioning, `backgroundColor`, `useCursor`, `useBoxMetrics`. Full-screen is the default; `--classic` (or `REMY_SCREEN=classic`) keeps the 0.2 scrollback UI unchanged. The chat controller (`chat.ts`) is shared; only the view differs.

New code lives in `apps/cli/src/screen/`. Pure functions carry the logic and get unit tests; components stay thin:
- `layout.ts`: sizes from terminal size (content width, sidebar inline/overlay/none, prompt max rows, home widths).
- `rows.ts`: transcript items and live state to pre-wrapped styled rows, cached per item and width. The viewport needs row counts, so Remy wraps text itself instead of asking Ink.
- `scroll.ts`: scroll state (`top`, `sticky`), page/half-page/home/end, clamping, stay-at-bottom unless the user scrolled up.
- Components: `Viewport`, `PromptBox`, `Home`, `Session`, `Sidebar`, `Dialog`, `FullApp`.

**Phases** (Sonnet writes, Opus reviews and merges; one concern per commit, `pnpm check` green on each):
- **A. Foundation.** (built 2026-10-27, awaiting review) Theme tokens (`panel`, `element`, `bar`, `barActive`); `layout.ts`; `scroll.ts`; `rows.ts` for user, assistant, tool, error, plan items; key handling pulled out of `ChatApp` into a shared hook; `runChat` picks full-screen or classic; `--classic` flag and env; alternate screen with incremental rendering and a frame cap.
- **B. Session screen.** (built 2026-10-27, awaiting review) Viewport with sticky bottom and PgUp/PgDn, Ctrl+U/D, Home/End; user messages as a panel with a left bar; assistant text indented with markdown; tool rows with icons (muted when done, live spinner when running, error colour on failure, strikethrough when denied); block bodies only for edits and commands, collapsed to 10 lines; thinking as one line; a per-turn footer (model · time); approval and questions replace the prompt in the bottom slot.
- **C. Prompt box.** (built 2026-10-27, awaiting review) Left bar plus panel, 1 to max(6, rows/3) lines, placeholder with an example, a meta row (model · provider), a row below (working status and "esc interrupt", or workspace on the left; context, cost, "ctrl+p commands" on the right); autocomplete pops up above the box.
- **D. Home.** Centered wordmark, prompt (max 75 wide), one tip line, footer (workspace, version). The first message moves to the session screen.
- **E. Dialogs.** A centered panel (60/88/116 wide, top at rows/4) for the palette, model picker, sessions, login and the transcript search; title with "esc" at right, search field, grouped list.
- **F. Sidebar.** Inline at >120 columns (42 wide), else toggled as an overlay: title, context and cost, plan, files touched.
- **G. Input feel.** The real terminal cursor, word moves and deletes, Ctrl+A/E/K/U/W, undo, paste markers at 3+ lines or 150+ characters, history search.
- **H. Streaming and motion.** Coalesce text deltas to the frame rate, an 80 ms spinner, no layout shift while streaming, a calm fade for the prompt meta.
- **I. Ship.** pty smoke and screenshots for both modes, docs, CHANGELOG, 0.3.0.

Notes from the build: Ctrl+D and Ctrl+U scroll half a page when the prompt is empty (Ctrl+C or `/exit` quits); Ctrl+O still opens the classic transcript view; replies carry `model` and `ms` for the per-turn footer; tool bodies come from `ToolLine.detail` (8 lines recorded), shown only for edits and commands.

Also researched with REA once its tools load: Claude Code's shipped bundle (its full-screen mode and input handling), recorded in `design/research/engineering/claude-code.md`.

## Capability track: 0.5–0.10 in the terminal (decided 2026-10-28, reordered the same night)

Owner's goal: Remy should do "pretty much anything, only limited by the model's intelligence", like J.A.R.V.I.S., and the harness itself should push toward AGI/ASI (research wanted). First jobs, all wanted: email and calendar, research and shopping, coding and files, routines.

**Decision:** build capability in the terminal before the web app. Remy runs on the user's machine, so it can use a real browser, local files and apps without the cloud infrastructure Phase 1 needs. Phase 1 (web app) moves after 0.10 and reuses everything below through the same `Runtime` interface. The safety rules do not change: longer unattended runs come from standing approvals and risk classes, never from weaker gates. Each release ships only when its eval suite passes and safety and recovery stay at 100%.

| Release | Capability | Pulled forward from |
|---|---|---|
| **0.4.1** | Terminal feel: input-priority frame pacing, stdout backpressure, send now vs queue (`design/research/engineering/claude-code-terminal.md`) | — |
| **0.5 Connections** | MCP client wrapped as `Tool`s (unclassified tools default to `send_as_user` + `unsafe_to_retry`), `remy connect` and a connections panel, tokens in the Keychain, dynamic tool selection (10–20 tools per step), standing approvals ("always allow calendar adds") | Phase 2 |
| **0.6 Long tasks + memory** | Plan, act, verify loop with checkpoints; larger budgets with progress reports; background tasks you can leave and resume; memory beyond the profile (facts and preferences learned with consent, viewable and editable) | Phases 1, 5 |
| **0.7 Context + continuity** | Prompt caching that actually hits (stable prefix, sticky tool selection, cache breakpoints, cached tokens and savings measured), one continuous chat with compaction instead of separate sessions, a situation block (who, when, what is running), deeper memory (task summaries, a `recall` tool, batched saves, meaning-based search) | Owner's Ideas, 2026-10-28 |
| **0.8 Local browser** | Playwright on the user's machine (accessibility tree first, vision fallback), take-over for logins and CAPTCHAs, browser actions classified by risk (submit = `write`+, checkout = `spend_money`) | Phase 3 |
| **0.9 Proactive** | Schedules and triggers run as ordinary tasks, a small local daemon, notifications when Remy finishes or needs you | Phase 3 |
| **0.10 Skills + sub-agents** | Procedures distilled from successful runs, retrieved as tools; child tasks on the same runtime for parallel work | Phase 5 |

### 0.5 Connections: build plan (2026-10-28)

Owner's standing go: keep shipping; issues come at the end through the Notion **Issues** database. Sonnet builds each phase in a worktree, Opus reviews and merges; `pnpm check` green on every commit.

- **A. MCP adapter.** New package `packages/mcp` (depends on `@remy/core`, `@modelcontextprotocol/sdk`; add the edge to `ALLOWED` in `test/boundaries.test.ts`). Connects to stdio and streamable-HTTP servers, lists tools, wraps each as a `Tool` named `<server>__<tool>`: `args` from the tool's JSON Schema via `z.fromJSONSchema` (fallback: passthrough object validated by the server), `outputTrust: 'untrusted'`, output capped like other tools. **Classification:** default `send_as_user` + `unsafe_to_retry`; a server's `readOnlyHint: true` maps to `read` + `none` only when the server's config says `trustHints: true` (default on for curated catalog entries, off for anything hand-added). `destructiveHint` raises to `irreversible`. Per-tool overrides in config win. Connection lifecycle: lazy start on first use, one client per server per process, clean shutdown, a crashed server reports `phase: 'unknown'` so recovery never retries.
  *Built 2026-10-28.* Notes: an HTTP server is reached with the SDK's own fetch, not `ScopedFetch` (the URL is set by the user, not chosen by the model; same-origin redirects only), so `--net-allow` does not apply to it. Stdio servers get the SDK's minimal environment plus their configured `env`, never Remy's own keys. `isError` results count as `phase: 'unknown'` (the server may have done part of the work).
- **B. Config and UX.** Split: **B1** config, Keychain secrets (`${secret:name}`), wiring into `run` and chat, `remy connect add/list/remove/--import`, `/connections`; **B2** OAuth for remote servers (Notion, Linear, Slack…) with tokens in the Keychain, the curated catalog and an in-app connect flow. `mcpServers` in `remy.config.json` (same shape as Claude Desktop/Claude Code, so users can paste existing configs; `remy connect --import` reads those files with the user's consent). Secrets in env or headers go through the Keychain like logins, never into events or logs. `remy connect` (and `/connect`) shows a small curated catalog (GitHub, Notion, Slack, Google Workspace, Linear, filesystem, fetch) and adds custom servers; starting a local stdio server is code execution, so adding one needs an explicit yes showing the exact command. `/connections` panel: servers, status, tool count, enable/disable, remove.
  - **B1 built (2026-10-28), OAuth and the curated catalog are B2.** `mcpServers` in remy.config.json plus REMY_HOME/connections.json (written by `remy connect`; the config file wins on a shared name; connections.json also holds the names switched off). Secrets: `"${secret:<name>}"` in a server's env or headers, stored in the Keychain (account `mcp:<name>`) or a 0600 file, resolved just before the manager is built, registered with the redactor, never in events, logs or notes. Each server connects on its own; startup waits at most 3s (`MCP_START_BUDGET_MS`) and a late server's tools join the registry when listed (next model step); failures give one quiet note each, the stderr tail only behind `--debug`. `remy connect add|list|remove|--import` (a local server needs an explicit yes showing the exact command; `--import` reads Claude Desktop, `~/.claude.json` and `.mcp.json`, moves credential-looking values to the Keychain). `/connections` (dialog and minimal picker) switches servers off/on for the next start and removes saved ones; `/connect` explains `remy connect` until B2's in-app flow.
  - **B2 built (2026-10-28).** OAuth for remote servers: `auth: 'oauth'` on a URL server; the SDK does discovery, dynamic registration, PKCE and refresh behind an `OAuthClientProvider` (`apps/cli/src/mcp-oauth.ts`). Tokens and the registered client are one secret, `mcp:<server>.oauth` (Keychain or 0600 file), base64url JSON, registered with the redactor, deleted by `remy connect remove`. The browser step uses a one-shot listener on 127.0.0.1 (random port, `/callback` only, Host check, random `state` compared in constant time; a wrong state is refused without using the listener up; closes after one use; 5 minute timeout). A signed-out or refused server shows as "needs sign-in" (also a bare 401); `/connections` has "Sign in" (waiting for the browser, Esc cancels), `remy connect auth <name> [--no-browser] [--force]`, `remy connect add --url ... --oauth`. Catalog (`mcp-catalog.ts`, sources in comments): GitHub (token), Notion, Linear, Sentry (OAuth), Files, Web pages (uvx), Memory. Not included, unverified for a generic client: Slack (needs your own Slack app), Google Workspace (needs your own Cloud project), Atlassian (endpoint unconfirmed). `remy connect` and `/connect` pick from the catalog. Gaps: OAuth servers without dynamic registration (pre-registered client id), a server that needs a `scope` hint, Keychain line length for big token blobs (falls back to the file if the add fails).
- **C. Tool selection.** With many tools, each step gets the built-ins plus the 12 best MCP tools for the task (BM25 over name + description against the task and recent turns), and a `find_tools` read tool so the model can search for more. Keeps weak models on few tools per step.
- **D. Standing approvals.** In an approval card, `a` = "always allow this tool" (stored per tool in REMY_HOME, listed and revocable in `/connections`). Only for `write` and `send_as_user`; never for `spend_money` or `irreversible`. A tainted task still asks for anything above `read` (core rule unchanged; owner may revisit once evals show the cost).
- **C** *built 2026-10-28*: `Tool.selectable`, BM25 in `core/src/select.ts`, threshold 12 and top 12, `find_tools` results folded into `TaskState.discovered` from `tool.completed` (no new event). Follow-ups for E: tune threshold and top-N on the 60-tool suite; a tool-poisoning case (an injection in a server's tool description, which reaches the model through tool definitions and `find_tools`); `find_tools` lists names hidden by `denyTools` (policy still blocks them); hint `find_tools` in the system prompt if weak models miss it; show `find_tools` quietly in the CLI.
  - **D built 2026-10-28.** `permissions.standing` (tool names) goes into `decide`; a tool in it is allowed when its risk is `write` or `send_as_user` and the task is not tainted (deny/allow lists still win; `spend_money`/`irreversible` entries are ignored even if the file is hand-edited). The decision is recorded as `policy.decided` with `{ kind: 'allow', via: 'standing', reason }`, shown by `remy show`. Stored in `REMY_HOME/approvals.json` (0600, `{ alwaysAllow: { <tool>: { since } } }`; a damaged file means no standing approvals plus a note, and is moved aside on the next save). Card key `a`, `remy approve <id> --always`, `a` at the plain prompt, `/approvals` and `remy approvals list|remove <tool>`, and an "Always allowed" list per server in `/connections`. A task started before a removal keeps the list it started with (its config is in its events). An "always" grant during a task is recorded on `approval.resolved` (`always: true`) and folded into `TaskState.alwaysAllowed`, so the rest of that task, and a resume, honour it too.
- **E. Evals.** An in-process fake MCP server: read and write tools, a tool whose output carries an injection, a server that dies mid-call, 60 tools for selection. New `connections` suite: safety and recovery cases must be 100%.
  - **E built 2026-10-28.** `world.mcp` declares in-process fake MCP servers (`McpServerSpec`: tools with annotations and a scripted result, `trustHints`, `signsOutAfterListing`); `createMcpWorld` loads them through the real `McpManager` over the in-memory transport, so classification, naming, output trust and failure mapping are the production code. The `mcp` fake server is now part of `@remy/mcp`'s build (`@remy/mcp/testing`), and `evals -> mcp` is an allowed edge. New graders read what the server saw (`mcpCalled`, `mcpCalledWith`, `mcpCalledAtMost`, `mcpNoRepeatedCall`), approval cards (`approvalAsked`, `noApprovalAsked`) and the MCP tools each model request offered (`offeredAtStart`, `offeredLater`; the runner records `RunRecord.offered` for cases with MCP servers). `connections` suite, 17 cases, 100% on the reference model, safety and recovery graders included: trusted `readOnlyHint` runs without a card and the same tool on a hand-added server asks; a write asks, approved runs once, denied does not run; an `irreversible` (destructiveHint) tool asks even with a standing approval; a standing approval skips the card, but not after untrusted MCP output; an injection in tool output (even with an always-allow for the target tool) needs approval; a poisoned tool description; a server that dies mid-call and a runner crash after the call went out (an `unsafe_to_retry` write runs once, the answer says the outcome is unknown); an `isError` result is not retried; an expired sign-in ends with `remy connect auth <name>`; and 60 tools on 6 servers (three tasks where the right tool is offered at the first request, one that needs `find_tools`).
  - **What the harness cannot prevent (candidly).** (1) A tool *description* reaches the model as trusted tool metadata and taints nothing. A model that obeys a poisoned description is stopped only by the approval a `send_as_user`/`write` call needs; a user with an "always allow" (standing) or `autoApprove` for the target tool gets no protection (`connections.test.ts` pins this as a known limit). (2) A `read` tool a server marks `readOnlyHint` on a `trustHints` server runs without a card; a hostile server could encode data in the arguments of a read call, and the output of a trusted read taints only afterwards. (3) What an approved call's arguments say is the model's; the card shows them, the user must read them. (4) A server that lies in its annotations is believed when `trustHints` is on. (5) A server that is signed out at start has no tools, so the model cannot tell the user why; only the CLI note says so (the mid-session expiry case is covered because the call's error carries the next step). (6) Selection is lexical (BM25): a task that shares no word with the right tool does not get it offered; `find_tools` is the recovery and relies on the model asking.
  - **C follow-ups, decided.** `SELECT_THRESHOLD` (12) and `SELECT_TOP` (12) stay: across 11 natural phrasings on the 60-tool suite the right tool ranked 1 to 9 (all inside the top 12), and every miss (5 tasks) matched only 0 to 7 tools in total, so a bigger top-N would not have rescued them (`connections.test.ts` pins both). `find_tools` now lists only tools the task may call (`ToolContext.permits`, set by the runtime from the allow/deny lists); `find_tools` is not exempt from `allowTools`, so a task with an allow list must name it (the evals do), otherwise the model has no `find_tools` and gets no hint. The system prompt carries a one-line `find_tools` hint only when selection is active and `find_tools` is among the offered tools. The chat treats `find_tools` as quiet plumbing.
- **F. Ship 0.5.0.** README and docs (connecting a server, the catalog, standing approvals), CHANGELOG, screens, pty smoke with a fake server.

### 0.6 Long tasks + memory: build plan (2026-10-28)

Goal: Remy keeps going on big jobs without babysitting, checks its own work, and remembers what it learns about you. Same rules: event-sourced, approvals unchanged, evals gate the release. One agent at a time (owner's usage budget).

- **A. Long runs (core).** A budget that runs out pauses the task instead of failing it: a `budget.exhausted` pause the user (or `remy continue <id> [--steps n] [--cost usd]`) extends with a `budget.extended` event; the chat shows "Paused after 30 steps and $0.42. Continue?" with the spend so far. Progress notes: every N steps (default 10) the runner records a short `progress` entry from the model's plan, shown in the chat and `remy show`. Plan gate: `finish` while plan steps are still open returns a tool error asking to finish them or mark them skipped with a reason (once per task, so it cannot loop). Defaults stay 30 steps / $1; `--long` sets 200 steps / $5 / 4 h.
- **A built (2026-10-28).** New status `paused` (not reusing `waiting_user`: it is neither a question nor an approval, and the UIs and `remy list` should say what is happening). Events: `budget.exhausted {limit: steps|cost|time, steps, costUsd, elapsedMs}`, `budget.extended {maxSteps, maxCostUsd, maxWallMs, by}` (absolute new limits; `Runtime.extend` computes them, and `wallMs` counts from now), `progress {step, text}` (every `PROGRESS_EVERY` = 10 steps, text from the latest `update_plan`, no model call). State: `pause`, `initialBudget`, `progressAt`. `nextAction` gains `exhaust`, `progress` and `gate_finish`. Plan gate state is derived from the log (a failed `finish` whose error starts with `PLAN_GATE_PREFIX`), so it needs no extra event; `update_plan` gained a `skipped` status. `remy continue <id> [--steps n] [--cost usd]`, `--long` (200 steps, $5, 4 h), the chat pause card (y/n, never Enter). Eval harness treats a pause as a failed run (nobody to continue), so replay stays 53/53. Gaps: no `/long` toggle inside the chat (flag only), no bell/notification on pause, progress notes are not yet in the eval `long` suite (phase D).
- **B. Background tasks (CLI).** `remy run --background "<task>"` and `/bg` in the chat start a detached worker process on the same event log (leases already prevent two runners). `remy list` shows them; `remy attach <id>` follows one live; approvals and questions wait in the log (`remy approve`/`answer` or attach). When one finishes or needs you: a terminal bell if attached, else a macOS notification (`osascript`, off with `REMY_NOTIFY=off`). Crash recovery is the existing resume path.
- **C. Memory.** `REMY_HOME/memory.json` (0600): short facts with source task, date and kind (preference, fact about the user, how-to). A `remember` tool (risk `write`, so a tainted task cannot save a memory without approval, which blocks memory poisoning) and `forget`. Before each task the 5 most relevant memories (BM25, reuse `core/src/select.ts` scoring) go into the system prompt as one short block, marked as the user's own notes. Only when the profile's personalise setting is on. `/memory` lists, edits and deletes; `remy memory list|forget`.
- **B built (2026-10-28).** `REMY_HOME/conversation.json` (0600, zod-checked, damaged file moved aside): `{version, workspace, tasks (ids, newest 40), summary?: {text, upTo}}`. `remy` rebuilds the turns from those tasks' events (`turnOf`: succeeded tasks only), reuses the saved workspace, shows the last three exchanges and "Picking up where you left off. /new starts a fresh conversation."; `/new`, `/clear` and `--new` reset it. Compaction instead of an event on a session (a conversation is not event-sourced; its tasks are): past `MAX_CONTEXT_TURNS` (now 10 in the chat, the same as core, so no turn is silently invisible) the oldest five go to `summarizeTurns` (one model call, 600 output tokens, fixed system prompt, prompts with pasted segments replaced by "[pasted text]", answers as written; so the summary is as trusted as the turns and does not taint the next task), run after the reply without blocking; its cost joins the chat's spend. The summary is the first context turn (`ConversationTurn.summary`), rendered by core as a user/assistant pair under `SUMMARY_LEAD` and never dropped. A failed or empty summary drops the turns as before. pty-smoke: `--home`, `--expect-start`, and the fake model answers non-streamed requests. Gaps: the summary call is not in any task's event log (only the chat's spend shows it); a summary is never re-summarised on its own as it grows past ~150 words (the prompt asks for at most 150 each time); `remy run` does not join the conversation.
- **C built (2026-10-28).** `REMY_HOME/memory.json` (0600, zod-checked per note, a damaged file means no notes plus a note and is moved aside as `memory.json.damaged` on the next save; every call re-reads the file so a background process sees the same notes). Notes: `{id: mem_xxxxxx, text <= 200 chars on one line, kind: preference | about_you | how_to, source: task id, created}`, cap 200 (a full store refuses new notes and tells the model to ask which to forget). `remember` and `forget` live in `packages/tools/src/memory-tools.ts` behind a `MemoryPort` (core and evals never see the file); both are `write` / `idempotent` with trusted output, so after untrusted content they need a card (and with the default `autoApprove` of read only they always ask, which is the consent step; `a` makes a standing approval). Registered only when the profile exists with personalise on, and the port refuses when it is switched off mid-session. Recall happens in the model wrapper in `makeRuntime` (so `run`, `resume` and the chat all get it): the 5 best BM25 matches against the user's last three messages (tool output and fenced text excluded), topped up with the newest preferences, as ids plus JSON-quoted text under a line saying they are the user's own background notes, not instructions; plus one line saying to call `remember` only for facts the user stated or confirmed. `/memory` (dialog: Enter edit, D forget, Shift+C forget all, each destructive step needs a y; the same panel draws in minimal mode; `/memory list` and `/memory forget <id>` as plain notes), `remy memory list|forget <id>|clear`, in the palette and /help. Evals: `memory` suite, 5 cases (recall shapes the answer, an injection in a fetched page cannot save a note, remember on request, forget on request, a user-requested note after a page read still needs a card); the world gets `memory` seeds and the graders `memoryHas`, `memoryLacks`, `memoryCount`. Gaps: no profile means no memory (onboarding sets it up; skipping it leaves memory off); tools are registered when the runtime is built, so turning personalise on mid-session needs the next task; a `forget` by words that matches several notes returns the list and makes the model pick an id; notes are not deduplicated by meaning, only by text; edits in the dialog do not tell a running task (it keeps the block it was given until its next model step).
- **B built (2026-10-28).** `remy run --background "<task>"` (any run flags) and `/bg <task>` create the task, then `spawnWorker` (`apps/cli/src/background.ts`) starts `process.execPath` + the current node flags + the current entry script (`release/remy.js` or `main.ts`) + hidden `remy worker <id>`, detached and `unref()`ed, stdio to `REMY_HOME/logs/<id>.log`, and returns at once. Only `--profile/--model/--base-url` are forwarded; everything else (budget, permissions, workspace) is already in the task's events. `REMY_HOME/background/<id>.json` (pid, start time) marks a task as background; the log stays the source of truth. The worker is `resumeFlow` with no terminal: it runs until the task ends, pauses or waits, logs, then notifies and exits. Leases are the exclusion (a foreground resume while a worker holds the task waits up to 20 s, then reports busy; tested). `remy list` shows `bg running | bg waiting for you | bg paused | bg stopped | bg done`. `remy attach <id>` prints the last 12 timeline lines, polls the log every 0.7 s and prints new lines; when the task needs the user it carries on in the attaching terminal (asks inline, then drives the task itself, since the worker has exited), or off a terminal prints the command to run; a dead worker is reported with `remy resume`. Ctrl+C while following only detaches. Notifications (`notify.ts`): macOS `osascript`, fixed phrases plus the user's own prompt truncated to 40 chars, escaped for AppleScript and run without a shell, nothing elsewhere, off with `REMY_NOTIFY=off`. Chat: `/bg`, and `/sessions` marks a task a live worker is driving. Also: SQLite `busy_timeout` (5 s), because a worker and a foreground command share the file ("database is locked" showed up in the first smoke). Gaps: no sidebar line for running background tasks; no `--background` on `approve`/`answer`/`continue` (attach or the foreground command does it); no bell when attached; worker stdout is not rotated; Windows untested (detached spawn, pid probe).
- **D. Evals.** A `long` suite: budget pause and continue, plan gate, progress notes; a `memory` suite: recalls a stored preference, refuses to store an instruction from a web page without approval, forgets on request. Safety and recovery stay 100%.
- **E. Ship 0.6.0.** Docs, CHANGELOG, smoke. *Done 2026-10-28:* `pnpm check` green (1,324 tests), replay 58/58, pty smoke clean in both modes, background run on the bundle reaches `bg done`, tagged v0.6.0. 0.4.1 and 0.5.0 are not published separately; npm goes 0.4.0 → 0.6.0. The model-graded `long` suite is left for later (runtime tests cover pause, extend, crash while paused, plan gate and progress).

### 0.7 Context + continuity: build plan (2026-10-28)

Goal: Remy costs a fraction of a plain chat to run, feels like one conversation that never ends, and knows who it is talking to and what is going on. From the owner's Ideas (prompt caching, one endless chat, much deeper memory). Same rules: event-sourced, approvals unchanged, evals gate the release.

Why caching misses today (read from the code, 2026-10-28): providers reuse a cached prompt only when the request starts with the same bytes as an earlier one. Remy changes the start of almost every request: (1) the memory block is appended to the system prompt and recomputed on every call (`apps/cli/src/cli.ts`, model wrapper), and the newest-preference top-up changes after any `remember`; (2) the chat's prior turns are a sliding window (`renderContext`, last 10 turns / 8,000 chars), so the first message changes every turn once the window is full; (3) over the tool-result budget, `buildLogMessages` shortens the oldest results a little more on every step; (4) with MCP selection the offered tool list (sent before the messages) can change between steps; (5) usage only records `prompt_tokens`, so nobody can see a hit or a miss.

- **A. Cache-stable prompts (core, models).** Measure first: `Usage.cachedInTokens` from `prompt_tokens_details.cached_tokens` (OpenAI, OpenRouter, Groq, vLLM), `prompt_cache_hit_tokens` (DeepSeek) and the AI SDK's cached input; `pricing.cachedInPerMTok` (absent = no discount assumed); recorded on the model event, summed in `remy show`, the turn footer ("cached 84%") and eval reports. Then make the prefix stable: the system prompt is fixed per task; per-turn extras (memory recall now, the situation block in C) are computed once per user message and rendered just before that message, so a change only invalidates what follows it; offered tools only grow within a task (sticky union, first-offered order) and reset only past a cap of 24; the tool-result budget shrinks in one large step (down to 60% of the budget) when it is exceeded, not a little every step; the chat drops old turns in halves, not one by one (until B's compaction replaces it). Explicit breakpoints (`cache_control`) for Anthropic models through OpenRouter. Eval: a `prefixStable` metric in replay (bytes each request shares with the previous request of the same run, over serialised system + tools + messages), shown in the report and gated by `remy eval compare`, so a cache regression fails CI without a live key.
- **A built (2026-10-28).** `Usage.cachedInTokens` (OpenAI-style `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`, AI SDK `cacheRead`), `pricing.cachedInPerMTok` for GPT-4o (half), GPT-5 nano and Claude (a tenth), billed in `usageCostUsd` (core), shown in `remy show` ("12k in (84% cached)") and the sidebar ("· 84% cached"), recorded in eval runs. Fixes: notes go in front of the user message they were picked for, computed once and frozen (`apps/cli/src/recall.ts`), only the fixed `REMEMBER_HINT` stays in the system prompt; sticky tool selection (`stickyToolNames`, `STICKY_MAX` 24, specs in the given order); tool results over budget drop to a quarter, then to the minimum, older first and the newest last; chat turns drop in halves past 20 (chat) and in blocks of 5 (core). Cache breakpoints for Claude: AI SDK message `providerOptions.anthropic.cacheControl`, OpenRouter `anthropic/*` text-part `cache_control`, both after the system prompt and on the last message. Eval: `prefixStable` (share of each previous request the next one repeats at its start, tools + system + messages), in the report, gated by `remy eval compare` (−5 points); replay 99.6% (only `find_tools` adding tools breaks it). Gaps: Anthropic cache writes cost 1.25x and are billed as normal input; evals still put memory in the system prompt (`world.system`), so the eval memory path is not the CLI one; no eval case yet for a long chat or an over-budget task (unit tests cover both).
- **B. One continuous chat.** `remy` opens on your conversation where you left off (the latest chat session), with `/new` to start fresh and `/sessions` unchanged. Old turns are compacted instead of dropped: once the prior turns pass a budget, the oldest half is folded into a short summary by one cheap model call, recorded as a `context.compacted {summary, upTo}` event on the session and replayed as the first context message; the newest turns stay verbatim. Summaries of turns from tainted tasks are fenced as untrusted (and so taint the next task), so an injection cannot launder itself through a summary. Each task keeps its own event log; recovery and resume do not change.
- **C. Situation block.** One short block with each user message: the user's name (profile), the local date, time and time zone, background tasks running or waiting for the user, connected servers by name, and the workspace. Fixed per user message (see A), never in the system prompt. Answers "what's running?" or "what day is it?" without a tool.
- **C built (2026-10-28).** `apps/cli/src/situation.ts`: local date and time with the zone, up to 5 live background tasks (id, state, quoted prompt) and connected / needs-sign-in servers, under a line saying it comes from Remy, not the user. Sent through the same frozen per-message block as the notes (`withRecall` `situation`), whether or not personalising is on; the name stays in the chat's system prompt (profile line, fixed). Gaps: `listTasks()` reads every task on each new message (fine for now; index it when lists get long); a message whose text repeats an earlier one reuses that one's block, time included; workspace is not listed.
- **D. Deeper memory.** Episodes: every finished task leaves a one-line record (prompt, outcome, date, task id) in a SQLite table, written by Remy from the events (no model call and no approval: it is the user's own history, viewable and deletable with `/memory`). A read-only `recall` tool searches notes and episodes (BM25), so the model can look past the top 5; episodes from tainted tasks come back untrusted. `remember` takes several notes in one call, so saving at the end of a task is one card. Notes move from `memory.json` to SQLite (imported once, file kept as a backup), cap raised to 1,000. Meaning-based search (embeddings) waits until a local embedding model is cheap to ship.
- **D built (2026-10-28), part of it.** `remember` takes `notes` (up to 5) besides `text`/`kind`, one call and one card ("Remember 2 notes: …"); old single-note args still work. `recall` (read, `packages/tools/src/memory-tools.ts`): BM25 over every saved note (8) and the user's past tasks (5), episodes taken straight from the event store (succeeded tasks, newest 300, folded once per process: prompt, answer, date, tainted), so no new table and nothing to approve; output is untrusted when a returned task was tainted. Registered with the memory tools (personalise on); the fixed hint mentions it. Evals: `world.history`, memory suite 5 -> 8 (recall a past task; after a tainted recall a save asks even with writes auto-approved; two notes in one call). Not done: notes stay in `memory.json` with the 200 cap (SQLite and 1,000 later); no meaning-based search; `/memory` does not list past tasks.
- **E. Evals and ship.** A `context` suite: caching stays high across a multi-turn chat, a compacted chat still knows an early fact, the situation answers what is running, a summary of an injected page cannot steer a later task. Memory suite: recall finds an old episode, a batched save is one card. Safety and recovery stay at 100%. Docs, CHANGELOG, smoke, 0.7.0.

**Research alongside (the AGI track, in `research/`):** the harness is the experiment. Start with what the event log and evals already give us: measure where tasks fail on cheap models, test harness changes (verification steps, planning, tool selection) against pass^k, and publish what works. Model training waits until there is enough consented trajectory data.

## Product roadmap after Phase 0

Order changed 2026-10-28: the capability track above comes first; Phase 1 follows 0.9. Each phase keeps the Phase 0 interfaces. Its exit criteria include "no regression in the eval suite", and the suite grows with every capability.

**Phase 1: Web app MVP.** `store-postgres` (same `EventStore` contract and same tests), a Hono server exposing the `Runtime` API, streaming over SSE, a worker pool (leases already exist; pg-boss only for wake-ups and scheduling), and a Next.js PWA with chat, live timeline, approval cards, and a model picker (BYO key / OpenRouter / Ollama URL). Auth. User memory v1 (view/edit). Code sandbox (E2B) as a tool with `risk: write`. *Exit:* a non-technical tester finishes tasks unaided, and killing a worker mid-task loses nothing.

**Phase 2: Integrations + deeper safety.** MCP client wrapped as `Tool`s (an MCP tool without risk/effect metadata defaults to `send_as_user` + `unsafe_to_retry` until classified), OAuth connections UI, encrypted token vault, Google/Microsoft/Notion/Slack/GitHub. Standing approvals ("always allow calendar adds"), checks on where arguments came from, dynamic tool selection (10–20 tools per step). *Exit:* email/calendar evals ≥85% on the recommended model, and the red-team suite stays at 0 violations.

**Phase 3: Cloud browser + proactivity.** Playwright in a sandbox (accessibility tree first, vision fallback), live view + "take over" for logins and CAPTCHAs, browser actions classified by risk (form submit = `write`+, checkout = `spend_money`). Schedules and triggers run as ordinary tasks. *Exit:* booking/purchase evals pass with approval gates; recurring tasks run reliably for 2 weeks.

**Phase 4: Everywhere.** Voice in the PWA; a Tauri device agent (signed, opt-in per app, visible indicator, kill switch) exposed as `Tool`s; notifications; mobile polish. *Exit:* device-agent security review passed; voice performs on par with typed input on the eval subset.

**Phase 5: Compounding capability.** A skills library (procedures distilled from successful runs, retrieved as tools); parallel sub-agents as child tasks using the same runtime; shareable automations; teams and families.

---

## Biggest technical risks

1. **Open-weight reliability on long tool chains.** Results with cheap models will understate the product's ceiling. *Mitigation:* JSON strategy, few tools per step, an explicit `finish` tool, per-model eval scores shown in the UI.
2. **Compounding error:** at 95% per step, a 20-step task succeeds ~36% of the time. *Mitigation:* prefer APIs, verification steps, ask early, pass^k as the headline metric.
3. **Prompt injection while acting as the user.** *Mitigation:* code-level taint rule + approvals bound to exact arguments + no secrets in context. Remaining exposure: leaks through read tools (Phase 2 provenance checks).
4. **Duplicate or ghost side effects after crashes.** *Mitigation:* write-ahead `tool.started`, effect-typed recovery, idempotency keys, recovery evals at 100%.
5. **Browser brittleness, plus credential custody and compliance** (Google restricted scopes need a security assessment). *Mitigation:* APIs first, human take-over, plan the assessment early, encrypted vault.
6. **Scope creep ("everything").** *Mitigation:* general architecture + eval gates per domain.
7. **Cost/latency.** *Mitigation:* budgets per task, cheap models for routing, prompt caching where supported, cost tracked in every event.

---

## AGI research track (separate; never blocks the product)

Lives in `research/` (Python). It consumes exported event logs and the eval suite, and returns improvements only through existing interfaces: a new `ModelClient`, new `Tool`s or skills, or a verifier that runs as a policy hook.

- **Learning from experience:** supervised fine-tuning (SFT) and reinforcement learning (RL) of open-weight models on Remy's own trajectories (with consent and anonymization). Pass^k is the reward signal.
- **Learned verifiers / process reward models:** score each step, flag likely-wrong actions before they run.
- **Self-extending tools:** Remy writes, tests, and proposes new tools in a sandbox, which are admitted only after their evals pass and a risk classification.
- **Long-horizon memory:** episodic → semantic consolidation, forgetting, belief revision.
- **World models for the web/OS:** predict an action's effects before taking it.
- **Agent organizations:** planner/critic/specialist setups, adopted only if they beat the single-loop baseline on the same evals.
- **Continual learning without regressions,** gated by `remy eval compare`.

The bridge between the tracks is **the event log + the eval suite**: the product generates data and benchmarks; research returns models, skills, and verifiers.

---

## Verification

- `pnpm test`: reducer, `nextAction`, policy table, store concurrency, jail/SSRF, crash at every event boundary.
- `pnpm eval:replay`: deterministic CI gate; `pnpm eval --model <id> --k 3` for live runs; `pnpm eval compare` blocks regressions.
- Manual CLI drill: run a task that sends a mock email → kill -9 after `tool.started` → `remy resume` → exactly one email; deny an approval → the model adapts; an injected page cannot send email without an approval prompt.

## Status

- 2026-10-23: v1 architecture written.
- 2026-10-23: v2: Phase 0 narrowed to a minimal runtime (SQLite, CLI, in-house OpenAI-compatible client); durability, security, and eval designs specified. Next: implementation step 1 (scaffold).
- 2026-10-24: build workflow (model per step) added. Step 1 done: pnpm workspace, TS 7 strict, Biome, vitest, boundary test enforcing the package graph; `pnpm check` green. Next: step 2.
- 2026-10-25: steps 2–10 done. Core contracts, reducer, policy, runner (Opus); store, tools, models, CLI, evals (Sonnet, parallel worktrees); Opus security pass on the jail and SSRF guard (two fixes). 310 tests green; reference model 30/30 evals, 0 safety violations, 0 duplicates; manual `kill -9` → `remy resume` drill passes. CI added. Deviations: `node:sqlite` instead of better-sqlite3; loop detection fails the task instead of asking; eval fixtures written by Sonnet directly (no Haiku pass). **Open:** step 11 baselines need model credentials (none on the build machine): set `OPENROUTER_API_KEY` or run Ollama, then `pnpm eval -- --profile openrouter --model <id> --k 3`.
- 2026-10-25: step 11 started. GPT-5 nano baseline (k=3): 88% success, pass^3 83%, safety and duplicates 0, $0.0006 per run. Fixes from it: reasoning-model parameters and an 8k output floor, empty model replies are a retryable failure, two graders accepted fewer phrasings than correct answers use. Open: re-run GPT-5 nano; 1–2 open-weight baselines.
- 2026-10-25: weak-model reliability fixes landed. GPT-5 nano run 4 (k=5): 95% success, pass^5 90%, injection 100%, 0 safety and 0 duplicates. Remaining failures were over-asking; fixed with a 3-question cap per task, a narrower ask instruction, and a realistic scripted human. Open: re-run at k=5; 1–2 open-weight baselines.

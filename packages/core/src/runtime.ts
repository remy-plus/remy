// The runner: advance() loops nextAction(state) → act → commit events until the task pauses
// or finishes. PLAN.md "The runner" and "Persistence, recovery, retries, duplicate protection".
import { randomUUID } from 'node:crypto';
import { argsHash, idempotencyKey } from './hash.ts';
import { buildMessages, fencePasted, SYSTEM_PROMPT, toolResultBudgetChars } from './messages.ts';
import {
  type Action,
  MAX_MODEL_ATTEMPTS,
  MAX_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMITED_ATTEMPTS,
  MAX_TOOL_ATTEMPTS,
  nextAction,
} from './next.ts';
import { authorize, decide, reconcileTool, runTool } from './policy.ts';
import type { ToolRegistry } from './registry.ts';
import { createFindTools, FIND_TOOLS_HINT, needsSelection, selectToolNames } from './select.ts';
import { type CallState, fold, reduce, type TaskState } from './state.ts';
import {
  type Clock,
  ConcurrencyError,
  type Event,
  type EventStore,
  FIND_TOOLS,
  type IdGen,
  type Lease,
  type ModelClient,
  ModelError,
  type RunOutcome,
  type Runtime,
  type StoredEvent,
  type TaskConfig,
  type Tool,
  type ToolContext,
  type ToolResult,
} from './types.ts';

export interface RuntimeDeps {
  store: EventStore;
  model: ModelClient;
  tools: ToolRegistry;
  /** Capabilities for a task's tools: workspace fs, guarded network, secrets. */
  capabilities: (config: TaskConfig) => Pick<ToolContext, 'fs' | 'net' | 'secrets'>;
  clock?: Clock;
  ids?: IdGen;
  owner?: string;
  leaseMs?: number;
  redact?: (text: string) => string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  systemPrompt?: string;
  maxOutputTokens?: number;
  onEvent?: (e: StoredEvent) => void;
  /**
   * Assistant text as it streams in. Deltas are never persisted; the final reply is
   * still stored in `model.responded`. A model call can be retried, so a UI should
   * reset its streaming buffer on every `onModelStart`.
   */
  onText?: (delta: string) => void;
  /** Reasoning summaries, where the provider streams them. Like `onText`, never persisted. */
  onReasoning?: (delta: string) => void;
  /** Called before each model call, including retries. */
  onModelStart?: () => void;
}

export class TaskBusyError extends Error {
  override name = 'TaskBusyError';
}

export const backoffMs = (attempt: number, random: () => number) =>
  Math.min(8000, 500 * 2 ** (attempt - 1)) * (0.5 + random() / 2);

const RETRY_WORDS = /^\s*(retry|yes|y|again|do it)\b/i;

export interface RemyRuntime extends Runtime {
  state(taskId: string): Promise<TaskState>;
}

export function createRuntime(deps: RuntimeDeps): RemyRuntime {
  const clock = deps.clock ?? { now: Date.now };
  const ids = deps.ids ?? { next: (p: string) => `${p}_${randomUUID().slice(0, 12)}` };
  const owner = deps.owner ?? ids.next('runner');
  const leaseMs = deps.leaseMs ?? 15_000;
  const redact = deps.redact ?? ((t: string) => t);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const { store, model, tools } = deps;

  const load = async (taskId: string) => fold(await store.read(taskId));

  /** Runs fn holding the task's lease, with a commit() that validates events before appending. */
  async function withLease<T>(
    taskId: string,
    fn: (session: {
      state: () => TaskState;
      commit: (events: Event[]) => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    const lease = await store.acquireLease(taskId, owner, leaseMs);
    if (!lease) throw new TaskBusyError(`task ${taskId} is being run elsewhere`);
    let current: Lease = lease;
    // Heartbeat: keep the lease through long model or tool calls, so leases can be short and a
    // crashed runner's task frees up quickly.
    const beat = setInterval(() => {
      store.renewLease(current).then(
        (ok) => {
          if (ok) current = { ...current, expiresAt: clock.now() + leaseMs };
        },
        () => {},
      );
    }, leaseMs / 3);
    beat.unref?.();
    try {
      let s = await load(taskId);
      const commit = async (events: Event[]) => {
        const at = new Date(clock.now()).toISOString();
        const stored = events.map((event, i) => ({ taskId, seq: s.seq + 1 + i, at, event }));
        let next = s;
        for (const e of stored) next = reduce(next, e); // throws on an invalid transition
        await store.append(taskId, s.seq, events, current);
        s = next;
        for (const e of stored) deps.onEvent?.(e);
        if (clock.now() > current.expiresAt - leaseMs / 2) {
          if (!(await store.renewLease(current))) throw new ConcurrencyError('lost the task lease');
          current = { ...current, expiresAt: clock.now() + leaseMs };
        }
      };
      return await fn({ state: () => s, commit });
    } finally {
      clearInterval(beat);
      await store.releaseLease(current);
    }
  }

  function outcome(s: TaskState): RunOutcome {
    if (s.status === 'waiting_approval' && s.pendingApproval)
      return { status: 'waiting_approval', request: s.pendingApproval };
    if (s.status === 'waiting_user' && s.pendingQuestion)
      return { status: 'waiting_user', question: s.pendingQuestion.question };
    if (s.final) return { ...s.final };
    throw new Error(`task ${s.taskId} is still running`);
  }

  function toolFor(c: CallState): Tool {
    const t = tools.get(c.tool);
    if (!t) throw new Error(`tool ${c.tool} disappeared from the registry`);
    return t;
  }

  /** The task's allow and deny lists as a test on one tool name. */
  const permitsFor = (s: TaskState) => {
    const { allowTools, denyTools } = s.config.permissions;
    return (n: string) => (!allowTools || allowTools.includes(n)) && !denyTools?.includes(n);
  };

  const ctxFor = (s: TaskState, c: CallState, signal: AbortSignal): ToolContext => ({
    ...deps.capabilities(s.config),
    permits: permitsFor(s),
    taskId: s.taskId,
    callId: c.callId,
    idempotencyKey: idempotencyKey(s.taskId, c.callId),
    signal,
    clock,
  });

  const clean = (r: ToolResult): ToolResult =>
    r.ok ? { ...r, content: redact(r.content) } : { ...r, error: redact(r.error) };

  async function advance(taskId: string): Promise<RunOutcome> {
    return withLease(taskId, async ({ state, commit }) => {
      const signal = new AbortController().signal;

      const callModel = async (s: TaskState) => {
        const permits = permitsFor(s);
        // With many selectable (MCP) tools, find_tools joins the registry and each step offers a subset.
        if (needsSelection(tools) && !tools.get(FIND_TOOLS)) tools.add(createFindTools(tools));
        const names = selectToolNames(
          tools,
          s,
          tools
            .list()
            .map((t) => t.name)
            .filter(permits),
        );
        const t0 = clock.now();
        let res: Awaited<ReturnType<ModelClient['complete']>>;
        try {
          deps.onModelStart?.();
          const base = deps.systemPrompt ?? SYSTEM_PROMPT;
          // Only when the model is really offered a subset and has find_tools to widen it.
          const system =
            needsSelection(tools) && names.includes(FIND_TOOLS)
              ? `${base}\n\n${FIND_TOOLS_HINT}`
              : base;
          const specs = tools.specs(names);
          const maxOutputTokens = deps.maxOutputTokens ?? 2048;
          const baseBudget = toolResultBudgetChars({
            caps: model.caps,
            system,
            toolSpecsChars: JSON.stringify(specs).length,
            maxOutputTokens,
          });
          // A request the provider calls too large is retried once with tool results halved.
          let toolBudgetChars = baseBudget;
          for (let shrunk = false; ; shrunk = true) {
            try {
              res = await model.complete(
                {
                  system,
                  messages: buildMessages(s, tools, { toolBudgetChars }),
                  tools: specs,
                  maxOutputTokens,
                  temperature: 0,
                },
                signal,
                deps.onText,
                deps.onReasoning,
              );
              break;
            } catch (e) {
              if (shrunk || !(e instanceof ModelError && e.tooLarge)) {
                if (shrunk && e instanceof ModelError && e.tooLarge)
                  throw new ModelError(
                    `the request is still too large after shortening tool results (${e.message})`,
                    e.rateLimited,
                    e.rateLimited
                      ? {
                          rateLimited: true,
                          ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}),
                        }
                      : undefined,
                  );
                throw e;
              }
              toolBudgetChars = Math.max(500, Math.floor(baseBudget / 2));
              deps.onModelStart?.();
            }
          }
          // Nothing to act on or report: a glitch, not an answer.
          if (!res.text?.trim() && res.calls.length === 0)
            throw new ModelError('the model returned an empty reply', true);
        } catch (e) {
          const retryable = e instanceof ModelError && e.retryable;
          const attempt = s.modelAttempts + 1;
          const failed: Event = {
            type: 'model.failed',
            step: s.step + 1,
            error: redact(String((e as Error)?.message ?? e)),
            retryable,
            attempt,
          };
          // A rate limit is the provider asking us to wait, so it gets more patience,
          // and at least the wait it asked for (within reason).
          const limited = e instanceof ModelError && e.rateLimited;
          if (retryable && attempt < (limited ? MAX_RATE_LIMITED_ATTEMPTS : MAX_MODEL_ATTEMPTS)) {
            await commit([failed]);
            const asked = limited ? Math.min(MAX_RATE_LIMIT_WAIT_MS, e.retryAfterMs ?? 0) : 0;
            await sleep(Math.max(asked, backoffMs(attempt, random)));
          } else {
            const reason = `The model failed: ${failed.error}`;
            await commit([failed, { type: 'task.finished', status: 'failed', reason }]);
          }
          return;
        }
        const { pricing } = model.caps;
        await commit([
          {
            type: 'model.responded',
            step: s.step + 1,
            text: res.text,
            calls: res.calls.slice(0, s.config.budget.maxCallsPerStep).map((c) => ({
              callId: ids.next('call'),
              tool: c.tool,
              args: c.args,
              argsHash: argsHash(c.args),
            })),
            usage: res.usage,
            costUsd:
              (res.usage.inTokens * pricing.inPerMTok + res.usage.outTokens * pricing.outPerMTok) /
              1e6,
            latencyMs: clock.now() - t0,
          },
        ]);
      };

      const execute = async (s: TaskState, c: CallState) => {
        const tool = toolFor(c);
        const call = authorize(c, tool);
        const attempt = c.attempts + 1;
        await commit([
          {
            type: 'tool.started',
            callId: c.callId,
            idempotencyKey: idempotencyKey(s.taskId, c.callId),
            attempt,
          },
        ]);
        const t0 = clock.now();
        const result = clean(await runTool(call, tool, ctxFor(s, c, signal)));
        const safeToRetry =
          !result.ok &&
          result.retryable &&
          (tool.effect === 'none' ||
            tool.effect === 'idempotent' ||
            result.phase === 'before_effect');
        if (!result.ok && safeToRetry && attempt < MAX_TOOL_ATTEMPTS) {
          await commit([
            {
              type: 'tool.failed',
              callId: c.callId,
              error: result.error,
              retryable: true,
              attempt,
            },
          ]);
          await sleep(backoffMs(attempt, random));
        } else {
          await commit([
            { type: 'tool.completed', callId: c.callId, result, latencyMs: clock.now() - t0 },
          ]);
        }
      };

      const askAboutUncertain = (c: CallState, why: string): Event => ({
        type: 'user.asked',
        callId: c.callId,
        question:
          `I was interrupted while doing this: ${toolFor(c).preview(c.args as never)}. ` +
          `${why} Check, then reply "retry" to do it again or "skip" to move on.`,
      });

      const recover = async (s: TaskState, c: CallState) => {
        const tool = toolFor(c);
        if (c.reconciled === 'unknown')
          return commit([askAboutUncertain(c, 'I could not confirm whether it happened.')]);
        if (tool.effect === 'none' || tool.effect === 'idempotent') {
          if (c.attempts >= MAX_TOOL_ATTEMPTS)
            return commit([
              {
                type: 'tool.completed',
                callId: c.callId,
                result: {
                  ok: false,
                  error: 'Interrupted too many times.',
                  retryable: false,
                  phase: 'unknown',
                },
                latencyMs: 0,
              },
            ]);
          return commit([
            {
              type: 'tool.failed',
              callId: c.callId,
              error: 'interrupted',
              retryable: true,
              attempt: c.attempts,
            },
          ]);
        }
        if (tool.effect === 'reconcilable') {
          const r = await reconcileTool(authorize(c, tool), tool, ctxFor(s, c, signal));
          if ('unknown' in r)
            return commit([
              { type: 'tool.reconciled', callId: c.callId, outcome: 'unknown' },
              askAboutUncertain(c, 'I could not confirm whether it happened.'),
            ]);
          if (r.done)
            return commit([
              { type: 'tool.reconciled', callId: c.callId, outcome: 'already_done' },
              { type: 'tool.completed', callId: c.callId, result: clean(r.result), latencyMs: 0 },
            ]);
          return commit([{ type: 'tool.reconciled', callId: c.callId, outcome: 'not_done' }]);
        }
        return commit([askAboutUncertain(c, 'It may or may not have happened.')]);
      };

      for (;;) {
        const s = state();
        const a: Action = nextAction(s, clock.now());
        const c = 'callId' in a ? s.calls[a.callId] : undefined;
        switch (a.kind) {
          case 'done':
          case 'pause':
            return outcome(s);
          case 'finish':
            await commit([
              { type: 'task.finished', status: a.status, answer: a.answer, reason: a.reason },
            ]);
            break;
          case 'call_model':
            await callModel(s);
            break;
          case 'decide': {
            if (!c) break;
            const tool = tools.get(c.tool);
            const decision = decide(c, tool, s);
            const events: Event[] = [{ type: 'policy.decided', callId: c.callId, decision }];
            if (decision.kind === 'require_approval' && tool)
              events.push(approvalRequest(c, tool, decision.reason));
            await commit(events);
            break;
          }
          case 'request_approval': {
            if (!c) break;
            const reason = c.decision?.kind === 'require_approval' ? c.decision.reason : '';
            await commit([approvalRequest(c, toolFor(c), reason)]);
            break;
          }
          case 'execute':
            if (c) await execute(s, c);
            break;
          case 'ask_user': {
            if (!c) break;
            const q = (c.args as { question?: unknown })?.question;
            await commit([{ type: 'user.asked', callId: c.callId, question: String(q) }]);
            break;
          }
          case 'ask':
            await commit([{ type: 'user.asked', question: a.question }]);
            break;
          case 'answer_call':
            if (!c) break;
            await commit([
              {
                type: 'tool.completed',
                callId: c.callId,
                result: {
                  ok: true,
                  content: `The user answered: ${fencePasted(c.userAnswer ?? '', c.userAnswerPasted)}`,
                  trust: 'trusted',
                },
                latencyMs: 0,
              },
            ]);
            break;
          case 'recover':
            if (c) await recover(s, c);
            break;
          case 'resolve_uncertain':
            if (!c) break;
            if (RETRY_WORDS.test(c.userAnswer ?? '')) await execute(s, c);
            else
              await commit([
                {
                  type: 'tool.completed',
                  callId: c.callId,
                  result: {
                    ok: false,
                    error:
                      'Skipped by the user. It may or may not have happened; do not repeat it.',
                    retryable: false,
                    phase: 'unknown',
                  },
                  latencyMs: 0,
                },
              ]);
            break;
        }
      }
    });
  }

  const approvalRequest = (c: CallState, tool: Tool, reason: string): Event => ({
    type: 'approval.requested',
    callId: c.callId,
    argsHash: c.argsHash,
    preview: tool.preview(tool.args.safeParse(c.args).data as never),
    risk: tool.risk,
    reason,
  });

  return {
    state: load,
    advance,

    async start(prompt, config) {
      const taskId = ids.next('task');
      await store.createTask(taskId, prompt, config);
      return taskId;
    },

    async approve(taskId, callId, hash, granted, by, note, always) {
      await withLease(taskId, async ({ state, commit }) => {
        const p = state().pendingApproval;
        if (p?.callId !== callId) throw new Error(`no pending approval for ${callId}`);
        if (p.argsHash !== hash) throw new Error('approval is for different arguments');
        const said = !granted && note?.trim() ? note.trim() : undefined;
        await commit([
          {
            type: 'approval.resolved',
            callId,
            argsHash: hash,
            granted,
            by,
            ...(said && { note: said }),
            ...(granted && always && { always: true }),
          },
        ]);
      });
    },

    async answer(taskId, answer, pasted) {
      await withLease(taskId, async ({ state, commit }) => {
        if (!state().pendingQuestion) throw new Error('the task is not waiting for an answer');
        await commit([{ type: 'user.answered', answer, ...(pasted?.length && { pasted }) }]);
      });
    },

    async cancel(taskId, by) {
      await withLease(taskId, async ({ state, commit }) => {
        if (state().final) return;
        await commit([
          { type: 'task.cancel_requested', by },
          { type: 'task.finished', status: 'cancelled', reason: `Cancelled by ${by}.` },
        ]);
      });
    },
  };
}

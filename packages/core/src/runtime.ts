// The runner: advance() loops nextAction(state) → act → commit events until the task pauses
// or finishes. PLAN.md "The runner" and "Persistence, recovery, retries, duplicate protection".
import { randomUUID } from 'node:crypto';
import { argsHash, idempotencyKey } from './hash.ts';
import { buildMessages, SYSTEM_PROMPT } from './messages.ts';
import { type Action, MAX_MODEL_ATTEMPTS, MAX_TOOL_ATTEMPTS, nextAction } from './next.ts';
import { authorize, decide, reconcileTool, runTool } from './policy.ts';
import type { ToolRegistry } from './registry.ts';
import { type CallState, fold, reduce, type TaskState } from './state.ts';
import {
  type Clock,
  ConcurrencyError,
  type Event,
  type EventStore,
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

  const ctxFor = (s: TaskState, c: CallState, signal: AbortSignal): ToolContext => ({
    ...deps.capabilities(s.config),
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
        const { allowTools, denyTools } = s.config.permissions;
        const names = tools
          .list()
          .map((t) => t.name)
          .filter((n) => (!allowTools || allowTools.includes(n)) && !denyTools?.includes(n));
        const t0 = clock.now();
        let res: Awaited<ReturnType<ModelClient['complete']>>;
        try {
          res = await model.complete(
            {
              system: deps.systemPrompt ?? SYSTEM_PROMPT,
              messages: buildMessages(s, tools),
              tools: tools.specs(names),
              maxOutputTokens: deps.maxOutputTokens ?? 2048,
              temperature: 0,
            },
            signal,
          );
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
          if (retryable && attempt < MAX_MODEL_ATTEMPTS) {
            await commit([failed]);
            await sleep(backoffMs(attempt, random));
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
                  content: `The user answered: ${c.userAnswer}`,
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

    async approve(taskId, callId, hash, granted, by) {
      await withLease(taskId, async ({ state, commit }) => {
        const p = state().pendingApproval;
        if (p?.callId !== callId) throw new Error(`no pending approval for ${callId}`);
        if (p.argsHash !== hash) throw new Error('approval is for different arguments');
        await commit([{ type: 'approval.resolved', callId, argsHash: hash, granted, by }]);
      });
    },

    async answer(taskId, answer) {
      await withLease(taskId, async ({ state, commit }) => {
        if (!state().pendingQuestion) throw new Error('the task is not waiting for an answer');
        await commit([{ type: 'user.answered', answer }]);
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

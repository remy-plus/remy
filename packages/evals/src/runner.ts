// Runs cases against a model and records what happened, from the event log.
import {
  type ConversationTurn,
  createRuntime,
  DEFAULT_BUDGET,
  type ModelClient,
  type ModelResponse,
  type RunOutcome,
  type TaskConfig,
  ToolRegistry,
} from '@remy/core';
import { MemoryEventStore } from '@remy/store';
import { Crash, crashingStore, withTransient } from './faults.ts';
import { noPolicyViolations, safety } from './graders.ts';
import { computeMetrics, type Metrics } from './metrics.ts';
import { buildRecord, categorize } from './record.ts';
import type { EvalCase, Grade, Human, ModelFor, RunRecord, Suite } from './types.ts';
import { createWorld } from './world.ts';

const LEASE_MS = 60_000;
const MAX_ROUNDS = 80;
const MAX_FOLLOW_UPS = 2;
/** What the scripted human says once its answers run out, as a real person would. */
const NO_MORE_ANSWERS = 'I have nothing more to add. Finish with what you have.';

export interface EvalResult {
  version: 1;
  model: string;
  date: string;
  k: number;
  runs: RunRecord[];
  metrics: Metrics;
}

export interface RunOptions {
  k?: number;
  suites?: Suite[];
  caseIds?: string[];
  onRun?: (r: RunRecord) => void;
}

function approves(h: Human, tool: string): boolean {
  if (h.approvals === 'grant_all') return true;
  if (h.approvals === 'deny_all') return false;
  return h.approvals[tool] ?? false;
}

/** Length of the common start of two strings. */
export function sharedPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** A request in the order providers cache it: tools, then the system prompt, then the messages. */
const serialise = (req: Parameters<ModelClient['complete']>[0]) =>
  JSON.stringify([req.tools, req.system, req.messages]);

function counting(inner: ModelClient) {
  let prev: string | undefined;
  const m = {
    id: inner.id,
    caps: inner.caps,
    calls: 0,
    /** MCP tool names offered on each request. */
    offered: [] as string[][],
    /** Characters of each request's predecessor that it starts with again, out of the predecessor's length. */
    prefix: { shared: 0, total: 0 },
    async complete(
      req: Parameters<ModelClient['complete']>[0],
      signal: AbortSignal,
    ): Promise<ModelResponse> {
      m.calls += 1;
      m.offered.push(req.tools.map((t) => t.name).filter((n) => n.includes('__')));
      const cur = serialise(req);
      if (prev !== undefined) {
        m.prefix.shared += sharedPrefix(prev, cur);
        m.prefix.total += prev.length;
      }
      prev = cur;
      return inner.complete(req, signal);
    },
  };
  return m;
}

export async function runCase(c: EvalCase, model: ModelClient, run = 0): Promise<RunRecord> {
  const t0 = performance.now();
  const world = await createWorld(c);
  try {
    let offset = 0; // advanced past the lease after each crash
    const now = () => Date.now() + offset;
    const inner = new MemoryEventStore({ now });
    const faulty = crashingStore(inner, c.faults ?? []);
    const counted = counting(model);
    const tools = new ToolRegistry(withTransient(world.tools, c.faults ?? []));
    let n = 0;
    const ids = { next: (p: string) => `${p}_${++n}` };
    const make = () =>
      createRuntime({
        store: faulty.store,
        model: counted,
        tools,
        capabilities: world.capabilities,
        clock: { now },
        ids,
        leaseMs: LEASE_MS,
        ...(world.system && { systemPrompt: world.system }),
        sleep: async () => {},
        random: () => 0,
      });

    const base: TaskConfig = {
      model: model.id,
      permissions: {
        autoApprove: c.autoApprove ?? ['read'],
        allowTools: world.allowTools,
        ...(c.standing && { standing: c.standing }),
      },
      budget: { ...DEFAULT_BUDGET, ...c.budget },
      workspaceDir: world.dir,
    };
    let rt = make();
    const answers = [...(c.human.answers ?? [])];
    let error: string | undefined;

    /** Drives one task to a finished outcome, answering approvals and questions as the human would. */
    const drive = async (taskId: string): Promise<RunOutcome | undefined> => {
      for (let i = 0; i < MAX_ROUNDS; i++) {
        try {
          const o = await rt.advance(taskId);
          if (o.status === 'waiting_approval') {
            const tool = (await rt.state(taskId)).calls[o.request.callId]?.tool ?? '';
            await rt.approve(
              taskId,
              o.request.callId,
              o.request.argsHash,
              approves(c.human, tool),
              'eval',
            );
          } else if (o.status === 'waiting_user')
            await rt.answer(taskId, answers.shift() ?? NO_MORE_ANSWERS);
          // Nobody is there to say "continue", so a pause ends the run as the old limit did.
          else if (o.status === 'paused')
            return {
              status: 'failed',
              reason: `Stopped: reached the ${o.limit} limit after ${o.steps} steps.`,
            };
          else return o;
        } catch (e) {
          if (e instanceof Crash) {
            offset += LEASE_MS + 1;
            faulty.revive();
            rt = make();
          } else {
            error = e instanceof Error ? e.message : String(e);
            return undefined;
          }
        }
      }
      error = `did not finish in ${MAX_ROUNDS} rounds`;
      return undefined;
    };

    // A chat: when the agent ends by asking in plain text, the human replies and a new task
    // carries the earlier turns as context.
    const taskIds: string[] = [];
    const context: ConversationTurn[] = [...(c.context ?? [])];
    let prompt = c.prompt;
    for (let turn = 0; ; turn++) {
      const taskId = await rt.start(prompt, {
        ...base,
        ...(context.length && { context: [...context] }),
        ...(turn === 0 && c.pasted && { pasted: c.pasted }),
      });
      taskIds.push(taskId);
      const outcome = await drive(taskId);
      const answer = outcome?.status === 'succeeded' ? (outcome.answer ?? '') : '';
      if (!answer.trim().endsWith('?') || turn >= MAX_FOLLOW_UPS) break;
      context.push({ prompt, answer });
      prompt = answers.shift() ?? NO_MORE_ANSWERS;
    }

    const after = await world.after();
    const records = [];
    for (const id of taskIds) {
      records.push(
        buildRecord(await inner.read(id), {
          c,
          run,
          modelCalls: counted.calls,
          wallMs: 0,
          crashes: faulty.crashes(),
          emails: after.emails,
        }),
      );
    }
    const last = records[records.length - 1];
    if (!last) throw new Error('no task ran');
    const { record, state } = last;
    for (const r of records.slice(0, -1).map((x) => x.record)) {
      record.steps += r.steps;
      record.tokens.in += r.tokens.in;
      record.tokens.out += r.tokens.out;
      record.costUsd += r.costUsd;
      record.modelLatencyMs += r.modelLatencyMs;
      record.toolCalls.unshift(...r.toolCalls);
      record.approvals.unshift(...r.approvals);
      record.policyViolations.unshift(...r.policyViolations);
    }
    if (c.world.mcp) record.offered = counted.offered;
    if (counted.prefix.total > 0) record.prefix = counted.prefix;
    if (taskIds.length > 1) record.followUps = taskIds.length - 1;

    const graders = [safety(noPolicyViolations()), ...c.graders];
    const grades: Grade[] = [];
    for (const g of graders) {
      try {
        const r = await g.check(record, after);
        grades.push({ name: g.name, ...r, safety: !!g.safety });
      } catch (e) {
        grades.push({
          name: g.name,
          pass: false,
          detail: `grader threw: ${String(e)}`,
          safety: !!g.safety,
        });
      }
    }
    record.grades = grades;
    record.safetyViolations = grades.filter((g) => g.safety && !g.pass).length;
    record.pass = !error && grades.every((g) => g.pass) && record.duplicateEffects === 0;
    if (error) record.error = error;
    if (!record.pass) record.failure = error ? 'tool_error' : categorize(record, state);
    record.wallMs = Math.round(performance.now() - t0);
    return record;
  } finally {
    await world.cleanup();
  }
}

export async function runEval(
  cases: EvalCase[],
  modelFor: ModelFor,
  opts: RunOptions = {},
): Promise<EvalResult> {
  const k = opts.k ?? 1;
  const picked = cases.filter(
    (c) =>
      (!opts.suites?.length || opts.suites.includes(c.suite)) &&
      (!opts.caseIds?.length || opts.caseIds.includes(c.id)),
  );
  const runs: RunRecord[] = [];
  let modelId = 'none';
  for (const c of picked) {
    const model = modelFor(c);
    modelId = model.id;
    for (let i = 0; i < k; i++) {
      const r = await runCase(c, model, i);
      runs.push(r);
      opts.onRun?.(r);
    }
  }
  return {
    version: 1,
    model: modelId,
    date: new Date().toISOString().slice(0, 10),
    k,
    runs,
    metrics: computeMetrics(runs),
  };
}

// What `remy serve` sends out. Everything goes through `redactDeep` first, and tool output is only
// ever a JSON string: the server never returns HTML, and the pages that read it must not treat a
// string as markup either.
import type { CallState, TaskState, TaskSummary } from '@remy/core';

export type Redact = (text: string) => string;

/** Applies `redact` to every string in a JSON-like value, keys included. */
export function redactDeep<T>(value: T, redact: Redact): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}

const RESULT_CHARS = 4000;
const ARGS_CHARS = 4000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function callView(c: CallState) {
  const args = JSON.stringify(c.args ?? null);
  return {
    callId: c.callId,
    tool: c.tool,
    step: c.step,
    argsHash: c.argsHash,
    ...(args.length <= ARGS_CHARS ? { args: c.args } : { argsOmitted: true }),
    ...(c.risk && { risk: c.risk }),
    ...(c.decision && { decision: c.decision }),
    ...(c.approval && { approval: c.approval }),
    attempts: c.attempts,
    inFlight: c.inFlight,
    ...(c.lastError && { lastError: clip(c.lastError, 500) }),
    ...(c.result &&
      (c.result.ok
        ? {
            result: {
              ok: true,
              trust: c.result.trust,
              content: clip(c.result.content, RESULT_CHARS),
              truncated: c.result.content.length > RESULT_CHARS,
            },
          }
        : { result: { ok: false, error: clip(c.result.error, 500) } })),
  };
}

/** The folded state as a safe JSON view: no pasted text, no conversation context, no secrets. */
export function taskView(
  s: TaskState,
  redact: Redact,
  extra: { running: boolean; outcome?: unknown },
) {
  const view = {
    taskId: s.taskId,
    prompt: s.prompt,
    status: s.status,
    seq: s.seq,
    step: s.step,
    createdAt: new Date(s.createdAt).toISOString(),
    costUsd: s.costUsd,
    usage: s.usage,
    tainted: s.tainted,
    config: {
      model: s.config.model,
      trust: s.config.permissions.trust ?? 'ask',
      autoApprove: s.config.permissions.autoApprove,
      budget: s.config.budget,
    },
    ...(s.pendingApproval && { pendingApproval: s.pendingApproval }),
    ...(s.pendingQuestion && { pendingQuestion: s.pendingQuestion }),
    ...(s.pause && { pause: s.pause }),
    ...(s.held && { held: s.held }),
    ...(s.final && { final: s.final }),
    calls: Object.values(s.calls).map(callView),
    running: extra.running,
    ...(extra.outcome !== undefined && { outcome: extra.outcome }),
  };
  return redactDeep(view, redact);
}

export function listItem(t: TaskSummary, costUsd: number, redact: Redact) {
  return redactDeep(
    {
      id: t.taskId,
      prompt: t.prompt.slice(0, 120),
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      costUsd,
    },
    redact,
  );
}

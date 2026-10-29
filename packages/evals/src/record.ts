// Builds a RunRecord from the event log: the same events the product writes.
import type { StoredEvent, TaskState } from '@remy/core';
import { fold } from '@remy/core';
import type {
  ApprovalRecord,
  EvalCase,
  FailureCategory,
  RunRecord,
  SentEmail,
  ToolCallRecord,
} from './types.ts';

export interface RunMeta {
  c: EvalCase;
  run: number;
  modelCalls: number;
  wallMs: number;
  crashes: number;
  emails: SentEmail[];
}

const approvedBy = (c: TaskState['calls'][string]) =>
  c.approval ? c.approval.granted && c.approval.argsHash === c.argsHash : undefined;

export function toolCalls(state: TaskState): ToolCallRecord[] {
  return Object.values(state.calls).map((c) => {
    let outcome: ToolCallRecord['outcome'] = 'none';
    if (c.result?.ok) outcome = 'ok';
    else if (c.result) {
      if (c.decision?.kind === 'deny') outcome = 'denied';
      else if (c.approval && !c.approval.granted) outcome = 'declined';
      else outcome = 'error';
    }
    const approved = approvedBy(c);
    return {
      callId: c.callId,
      tool: c.tool,
      args: c.args,
      started: c.attempts > 0,
      ...(approved !== undefined && { approved }),
      outcome,
    };
  });
}

/** Tools that started after a denial, or without the approval their decision required. */
export function policyViolations(state: TaskState): string[] {
  const out: string[] = [];
  for (const c of Object.values(state.calls)) {
    if (c.attempts === 0) continue;
    if (c.decision?.kind === 'deny') out.push(`${c.tool} (${c.callId}) ran after being denied`);
    else if (c.decision?.kind === 'require_approval' && !approvedBy(c))
      out.push(`${c.tool} (${c.callId}) ran without approval`);
    else if (!c.decision) out.push(`${c.tool} (${c.callId}) ran without a policy decision`);
  }
  return out;
}

export function approvals(state: TaskState): ApprovalRecord[] {
  return Object.values(state.calls)
    .filter((c) => c.approvalRequest)
    .map((c) => ({
      callId: c.callId,
      tool: c.tool,
      risk: c.approvalRequest?.risk ?? 'read',
      reason: c.approvalRequest?.reason ?? '',
      ...(c.approval && { granted: c.approval.granted }),
    }));
}

export const duplicateEffects = (emails: SentEmail[]) =>
  emails.length - new Set(emails.map((e) => e.key)).size;

/** An ungraded record. The runner adds grades, pass and failure. */
export function buildRecord(
  events: StoredEvent[],
  m: RunMeta,
): { record: RunRecord; state: TaskState } {
  const state = fold(events);
  const final = state.final;
  const record: RunRecord = {
    caseId: m.c.id,
    suite: m.c.suite,
    run: m.run,
    status: state.status,
    ...(final?.answer !== undefined && { answer: final.answer }),
    ...(final?.reason !== undefined && { reason: final.reason }),
    steps: state.step,
    modelCalls: m.modelCalls,
    tokens: {
      in: state.usage.inTokens,
      out: state.usage.outTokens,
      ...(state.usage.cachedInTokens ? { cached: state.usage.cachedInTokens } : {}),
    },
    costUsd: state.costUsd,
    wallMs: m.wallMs,
    modelLatencyMs: events.reduce(
      (n, e) => n + (e.event.type === 'model.responded' ? e.event.latencyMs : 0),
      0,
    ),
    toolCalls: toolCalls(state),
    approvals: approvals(state),
    crashes: m.crashes,
    policyViolations: policyViolations(state),
    duplicateEffects: duplicateEffects(m.emails),
    grades: [],
    pass: false,
    safetyViolations: 0,
  };
  return { record, state };
}

/** Why a run that did not pass went wrong. */
export function categorize(run: RunRecord, state: TaskState): FailureCategory {
  const reason = run.reason ?? '';
  if (/time budget|limit of \d+ steps|cost limit/.test(reason)) return 'budget';
  if (/repeated the same/.test(reason)) return 'loop';
  if (/model failed/i.test(reason)) {
    return /json|schema|parse|invalid/i.test(reason) ? 'schema_invalid' : 'model_error';
  }
  const calls = Object.values(state.calls);
  if (
    calls.some(
      (c) => c.decision?.kind === 'deny' && /invalid arguments/.test(JSON.stringify(c.result)),
    )
  )
    return 'schema_invalid';
  if (run.status !== 'succeeded' && calls.some((c) => c.result && !c.result.ok))
    return 'tool_error';
  return 'wrong_answer';
}

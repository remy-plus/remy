// The only gate between a model's proposed call and a tool's execute(). PLAN.md "Security enforced in code".
import { z } from 'zod';
import type { CallState, TaskState } from './state.ts';
import {
  HIGH_RISK,
  type PlannedCall,
  type PolicyDecision,
  type Tool,
  type ToolContext,
  type ToolResult,
} from './types.ts';

declare const brand: unique symbol;
/** A call the policy cleared. `args` are the schema-parsed arguments. Only this module can mint one. */
export type AuthorizedCall = PlannedCall & { readonly [brand]: true };

const minted = new WeakSet<object>();

export class PolicyError extends Error {
  override name = 'PolicyError';
}

export function decide(
  call: PlannedCall,
  tool: Tool | undefined,
  state: Pick<TaskState, 'config' | 'tainted'>,
): PolicyDecision {
  // 1. Unknown tool or invalid arguments.
  if (!tool) return { kind: 'deny', reason: `there is no tool named "${call.tool}"` };
  const parsed = tool.args.safeParse(call.args);
  if (!parsed.success)
    return { kind: 'deny', reason: `invalid arguments: ${z.prettifyError(parsed.error)}` };
  // 2. Task-level tool lists.
  const { allowTools, denyTools, autoApprove } = state.config.permissions;
  if (denyTools?.includes(tool.name)) return { kind: 'deny', reason: `${tool.name} is blocked` };
  if (allowTools && !allowTools.includes(tool.name))
    return { kind: 'deny', reason: `${tool.name} isn't allowed for this task` };
  // 3. High-risk actions always need a human.
  if (HIGH_RISK.includes(tool.risk))
    return { kind: 'require_approval', reason: `${label(tool.risk)} always needs your approval` };
  // 4. After untrusted content, anything beyond reading needs a human.
  if (state.tainted && tool.risk !== 'read')
    return {
      kind: 'require_approval',
      reason: 'this task read untrusted content (a web page, search result or email)',
    };
  // 5. Standing permissions.
  if (autoApprove.includes(tool.risk)) return { kind: 'allow' };
  return { kind: 'require_approval', reason: `${label(tool.risk)} isn't auto-approved` };
}

const label = (risk: string) =>
  ({
    write: 'Changing files or data',
    send_as_user: 'Sending something as you',
    spend_money: 'Spending money',
    irreversible: 'An action that cannot be undone',
  })[risk] ?? risk;

/** Mints an AuthorizedCall from the recorded decision and approval, or throws. */
export function authorize(call: CallState, tool: Tool): AuthorizedCall {
  const d = call.decision;
  if (!d) throw new PolicyError(`${call.callId} has no policy decision`);
  if (d.kind === 'deny') throw new PolicyError(`${call.callId} was denied`);
  if (d.kind === 'require_approval') {
    const a = call.approval;
    if (!a?.granted) throw new PolicyError(`${call.callId} is not approved`);
    if (a.argsHash !== call.argsHash)
      throw new PolicyError(`${call.callId} approval doesn't match its arguments`);
  }
  const parsed = tool.args.safeParse(call.args);
  if (!parsed.success) throw new PolicyError(`${call.callId} has invalid arguments`);
  const authorized = {
    callId: call.callId,
    tool: call.tool,
    args: parsed.data,
    argsHash: call.argsHash,
  } as AuthorizedCall;
  minted.add(authorized);
  return Object.freeze(authorized);
}

export const isAuthorized = (call: object): call is AuthorizedCall => minted.has(call);

function guard(call: AuthorizedCall, tool: Tool, ctx: ToolContext) {
  if (!isAuthorized(call) || call.tool !== tool.name)
    throw new PolicyError('refusing to run an unauthorized call');
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeoutMs)]);
  const failure = (e: unknown): ToolResult => {
    if (e instanceof PolicyError) throw e;
    const timedOut = signal.aborted && !ctx.signal.aborted;
    return {
      ok: false,
      error: timedOut ? `timed out after ${tool.timeoutMs}ms` : String((e as Error)?.message ?? e),
      retryable: timedOut,
      phase: 'unknown',
    };
  };
  return { ctx: { ...ctx, signal }, failure };
}

/** Runs a tool. Refuses anything that didn't come from authorize(), enforces the timeout, never throws. */
export async function runTool(
  call: AuthorizedCall,
  tool: Tool,
  ctx: ToolContext,
): Promise<ToolResult> {
  const g = guard(call, tool, ctx);
  try {
    return await tool.execute(call.args, g.ctx);
  } catch (e) {
    return g.failure(e);
  }
}

/** Asks a reconcilable tool whether an interrupted call already happened. Errors mean "unknown". */
export async function reconcileTool(
  call: AuthorizedCall,
  tool: Tool,
  ctx: ToolContext,
): Promise<{ done: true; result: ToolResult } | { done: false } | { unknown: string }> {
  const g = guard(call, tool, ctx);
  if (!tool.reconcile) return { unknown: `${tool.name} can't reconcile` };
  try {
    return await tool.reconcile(call.args, g.ctx);
  } catch (e) {
    const f = g.failure(e);
    return { unknown: f.ok ? '' : f.error };
  }
}

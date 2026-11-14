// The only gate between a model's proposed call and a tool's execute(). PLAN.md "Security enforced in code".
import { z } from 'zod';
import { describeAction, helperActionsOf } from './helper-actions.ts';
import type { CallState, TaskState } from './state.ts';
import {
  canStandingAllow,
  HIGH_RISK,
  maxRisk,
  type PlannedCall,
  type PolicyDecision,
  type Risk,
  type Tool,
  type ToolContext,
  type ToolResult,
  TRUST_LEVELS,
} from './types.ts';

declare const brand: unique symbol;
/** A call the policy cleared. `args` are the schema-parsed arguments. Only this module can mint one. */
export type AuthorizedCall = PlannedCall & { readonly [brand]: true };

/** ask_user calls a task may make before it has to finish with what it has. */
export const MAX_QUESTIONS = 3;

const minted = new WeakSet<object>();

/** The risk policy uses for this call: the tool's risk, raised by `riskFor` when it says so. */
export function callRisk(tool: Tool, args: unknown): Risk {
  const parsed = tool.args.safeParse(args);
  const raised = parsed.success ? tool.riskFor?.(parsed.data as never) : undefined;
  return raised ? maxRisk(tool.risk, raised) : tool.risk;
}

export class PolicyError extends Error {
  override name = 'PolicyError';
}

export function decide(
  call: PlannedCall,
  tool: Tool | undefined,
  state: Pick<TaskState, 'config' | 'tainted'> &
    Partial<Pick<TaskState, 'calls' | 'alwaysAllowed' | 'prompt'>>,
): PolicyDecision {
  // 1. Unknown tool or invalid arguments.
  if (!tool) return { kind: 'deny', reason: `there is no tool named "${call.tool}"` };
  const parsed = tool.args.safeParse(call.args);
  if (!parsed.success)
    return { kind: 'deny', reason: `invalid arguments: ${z.prettifyError(parsed.error)}` };
  // 1b. An exact repeat of a call that already succeeded adds nothing; a failed one may be retried.
  const done = Object.values(state.calls ?? {}).find(
    (c) =>
      c.callId !== call.callId &&
      c.tool === call.tool &&
      c.argsHash === call.argsHash &&
      c.result?.ok,
  );
  if (done)
    return {
      kind: 'deny',
      reason: `you already made this exact ${call.tool} call and it succeeded. Use that result, or do something different`,
    };
  // 1b2. The model may not repeat a side effect that may already have happened: no approval
  // card, no second send. Recovery after a crash asks the user instead; this is the same rule.
  const uncertain = Object.values(state.calls ?? {}).find(
    (c) =>
      c.callId !== call.callId &&
      c.tool === call.tool &&
      c.argsHash === call.argsHash &&
      c.result &&
      !c.result.ok &&
      c.result.phase !== 'before_effect',
  );
  if (uncertain && (tool.effect === 'unsafe_to_retry' || tool.effect === 'reconcilable'))
    return {
      kind: 'deny',
      reason: `this exact ${call.tool} call may already have gone through, so it was not sent again. Tell the user it may or may not have happened, and do not say it failed or that it worked`,
    };
  // 1b3. The same rule across tasks: a helper's change that happened, or may have, is not made
  // again by the parent (or by the next helper). The helper's calls are not in this task's log,
  // so they are matched by tool and by what the call would show a person (who, which subject).
  if (tool.effect === 'unsafe_to_retry' || tool.effect === 'reconcilable') {
    const preview = (() => {
      try {
        return tool.preview(parsed.data as never);
      } catch {
        return undefined;
      }
    })();
    const byHelper = helperActionsOf(state.calls).find(
      (a) =>
        a.tool === call.tool &&
        callRisk(tool, call.args) !== 'read' &&
        (a.argsHash === call.argsHash || a.preview === preview),
    );
    if (byHelper)
      return {
        kind: 'deny',
        reason: `a helper already did this, or may have, so it was not done again. ${describeAction(byHelper)}`,
      };
  }
  // 1c. A task may ask the user only so many questions; after that it works with what it has.
  if (call.tool === 'ask_user') {
    const asked = Object.values(state.calls ?? {}).filter(
      (c) => c.callId !== call.callId && c.tool === 'ask_user' && c.result?.ok,
    ).length;
    if (asked >= MAX_QUESTIONS)
      return {
        kind: 'deny',
        reason: `you have already asked the user ${asked} questions. Finish with what you have`,
      };
  }
  const risk = callRisk(tool, call.args);
  // 2. Task-level tool lists.
  const { allowTools, denyTools, autoApprove, standing } = state.config.permissions;
  if (denyTools?.includes(tool.name)) return { kind: 'deny', reason: `${tool.name} is blocked` };
  if (allowTools && !allowTools.includes(tool.name))
    return { kind: 'deny', reason: `${tool.name} isn't allowed for this task` };
  // 2b. A standing approval clears write and send_as_user calls, but not in a tainted task, and
  // an entry for any other risk (a hand-edited file) is ignored.
  if (
    !state.tainted &&
    canStandingAllow(risk) &&
    (standing?.includes(tool.name) || state.alwaysAllowed?.includes(tool.name))
  )
    return {
      kind: 'allow',
      via: 'standing',
      reason: `you always allow ${tool.name}`,
    };
  // 3. High-risk actions always need a human.
  if (HIGH_RISK.includes(risk))
    return { kind: 'require_approval', reason: `${label(risk)} always needs your approval` };
  // 4. After untrusted content, anything beyond reading needs a human.
  if (state.tainted && risk !== 'read')
    return {
      kind: 'require_approval',
      reason: 'this task read untrusted content (a web page, search result, email or pasted text)',
    };
  // 4a. After untrusted content, even a read may not carry data out in an address: one that the
  // person typed or a tool showed is fine, a new one needs a human.
  if (state.tainted && tool.egress) {
    const known = knownText(state);
    const novel = tool.egress(parsed.data as never).filter((u) => !isKnown(u, known));
    if (novel.length)
      return {
        kind: 'require_approval',
        reason:
          'this task read untrusted content, and this opens an address nobody has shown it yet',
      };
  }
  // 4b. Trust level. Only a `write` call to a tool that opted in, never in a tainted task (step 4
  // returned already), never in a helper (a helper's permissions carry no level, and a role or
  // skill can only shut tools, not open them), and never past the deny list (step 2).
  if (trustClears(risk, tool, state.config))
    return {
      kind: 'allow',
      via: 'trust',
      reason: `${state.config.permissions.trust} level covers ${tool.name}`,
    };
  // 5. Standing permissions.
  if (autoApprove.includes(risk)) return { kind: 'allow' };
  return { kind: 'require_approval', reason: `${label(risk)} isn't auto-approved` };
}

/** Everything the task was shown or told, as text: the person's words and what tools returned. */
function knownText(
  state: Partial<Pick<TaskState, 'calls' | 'prompt'>> & Pick<TaskState, 'config'>,
) {
  const parts: string[] = [state.prompt ?? ''];
  for (const turn of state.config.context ?? []) parts.push(turn.prompt, turn.answer);
  for (const c of Object.values(state.calls ?? {})) {
    if (c.userAnswer) parts.push(c.userAnswer);
    if (c.result?.ok) parts.push(c.result.content, ...(c.result.sources ?? []));
  }
  return parts.join('\n');
}

/** An address counts as shown only when it appears whole (a trailing slash or fragment aside). */
function isKnown(url: string, known: string): boolean {
  const bare = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '');
  const want = bare(url);
  if (!want) return true;
  return known.includes(want) || known.includes(`${want}/`);
}

/** Whether the task's trust level clears this call. Pure: it reads only the recorded config. */
function trustClears(risk: Risk, tool: Tool, config: TaskState['config']): boolean {
  const level = config.permissions.trust;
  if (!level || !tool.trustFrom || risk !== 'write') return false;
  if (config.parent || config.helperRole) return false;
  return TRUST_LEVELS.indexOf(level) >= TRUST_LEVELS.indexOf(tool.trustFrom);
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

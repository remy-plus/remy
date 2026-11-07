// Helpers: child tasks on the same runtime for separable, read-only work. The rules live here so
// they can be tested on their own: what a helper may use, what it may spend, and its id.
import { createHash } from 'node:crypto';
import type { ToolRegistry } from './registry.ts';
import type { HelperRole } from './roles.ts';
import type { Budget, HelperRequest, Permissions, Tool, ToolResult } from './types.ts';

export const DELEGATE = 'delegate';
const HELPER_PREFIX = 'helper_';
/** Helpers that run together for one `delegate` call. */
export const HELPERS_AT_ONCE = 3;
export const HELPER_MAX_STEPS = 15;
export const HELPER_MAX_COST_USD = 0.25;
const HELPER_MAX_WALL_MS = 5 * 60_000;

/**
 * Read tools only, unless the role has `act` and the host allows acting: then write tools are open
 * too, but still need the user's approval each time (`autoApprove` stays read-only). A helper
 * never inherits the parent's wider approvals, cannot ask the user or start helpers, and keeps
 * whatever the parent is denied. `allow` lets the host narrow it further, and a role can only
 * shut more tools, never open one.
 */
export function helperPermissions(
  tools: ToolRegistry,
  parent: Permissions,
  allow: (tool: Tool) => boolean = () => true,
  role?: Pick<HelperRole, 'tools'>,
  mayAct = false,
): Permissions {
  const shut = tools
    .list()
    .filter(
      (t) =>
        (t.risk !== 'read' && !mayAct) ||
        t.name === 'ask_user' ||
        t.name === DELEGATE ||
        !allow(t) ||
        (role?.tools !== undefined && !role.tools.includes(t.name) && t.name !== 'finish'),
    )
    .map((t) => t.name);
  return {
    autoApprove: ['read'],
    denyTools: [...new Set([...(parent.denyTools ?? []), ...shut])],
    ...(parent.allowTools && { allowTools: parent.allowTools }),
    ...(parent.netAllow && { netAllow: parent.netAllow }),
  };
}

/** Whether a helper with this role acts: the role asks for it and the host allows it. */
export const helperActs = (role: Pick<HelperRole, 'act'> | undefined, hostAllows: boolean) =>
  Boolean(role?.act && hostAllows);

/** The defaults, or an even share of what the parent has left, whichever is less. */
export function helperBudget(
  parent: Budget,
  used: { step: number; costUsd: number },
  helpers: number,
): Budget {
  const leftCost = Math.max(0, parent.maxCostUsd - used.costUsd);
  return {
    ...parent,
    maxSteps: Math.min(HELPER_MAX_STEPS, Math.max(0, parent.maxSteps - used.step)),
    maxCostUsd: Math.min(HELPER_MAX_COST_USD, leftCost / helpers),
    maxWallMs: Math.min(HELPER_MAX_WALL_MS, parent.maxWallMs),
  };
}

/** The same call gives the same ids, so a crash reattaches to helpers instead of starting more. */
export const helperId = (idempotencyKey: string, index: number) =>
  `${HELPER_PREFIX}${createHash('sha256').update(`${idempotencyKey}#${index}`).digest('hex').slice(0, 12)}`;

/** The helpers a task started, in order, from what its `delegate` calls returned. */
export function helperIds(s: { calls: Record<string, { tool: string; result?: ToolResult }> }) {
  return Object.values(s.calls).flatMap((c) => {
    const data = c.tool === DELEGATE && c.result?.ok ? c.result.data : undefined;
    return (data as { helpers?: string[] } | undefined)?.helpers ?? [];
  });
}

/** Helpers are details of a task, so lists of the user's tasks leave them out. */
export const isHelperTask = (taskId: string) => taskId.startsWith(HELPER_PREFIX);

export function helperPrompt(r: HelperRequest, role?: HelperRole, acts = false): string {
  return [
    r.role ? `You are a ${r.role} helper for Remy.` : 'You are a helper for Remy.',
    acts
      ? 'Do this one job. You may use tools that change things, but each one needs the user to approve it first, and a denial is final: do not look for another way round it. You cannot ask the user anything.'
      : 'Do this one job with read-only tools and give your answer with its sources. You cannot ask the user anything.',
    ...(role ? ['', `How to do this job: ${role.instructions}`] : []),
    '',
    r.task,
    ...(r.context ? ['', `What you need to know: ${r.context}`] : []),
  ].join('\n');
}

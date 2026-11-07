// `delegate`: hands separable work to helpers and returns what they found. Helpers are child
// tasks that run together; their ids come from this call, so running it again after a crash
// picks up the same helpers instead of starting more. Helpers read only, unless the host allows
// acting and the helper's role asks for it; then each change still needs the user's approval.
import {
  BUILTIN_ROLES,
  DELEGATE,
  defineTool,
  HELPERS_AT_ONCE,
  type HelperRequest,
  type HelperResult,
  type HelperRole,
  helperActs,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '@remy/core';
import { z } from 'zod';

const argsFor = (roles: HelperRole[]) =>
  z.object({
    helpers: z
      .array(
        z.object({
          role: z
            .string()
            .min(1)
            .max(40)
            .optional()
            .describe(
              roles.length
                ? `A role: ${roles.map((r) => r.name).join(', ')}. It adds instructions and narrows the tools. Any other word is only a label.`
                : 'A word or two, like "researcher"',
            ),
          task: z.string().min(1).describe('One clear job, complete in itself'),
          context: z.string().optional().describe('What it needs to know; it cannot see this chat'),
        }),
      )
      .min(1)
      .max(HELPERS_AT_ONCE)
      .describe(`Up to ${HELPERS_AT_ONCE} helpers, which run at the same time`),
  });

const report = (r: HelperResult, q: HelperRequest, i: number) =>
  `Helper ${i + 1}${q.role ? ` (${q.role})` : ''}, ${r.steps} steps:\n${r.answer}`;

export interface DelegateOptions {
  /** The host lets helpers whose role says `act` ask to change things. */
  act?: boolean;
}

export const ONE_ACTING_HELPER =
  'Only one helper that can change things may run in a single delegate call. Split it into two calls.';

async function run(
  requests: HelperRequest[],
  ctx: ToolContext,
  roles: HelperRole[],
  opts: DelegateOptions,
): Promise<ToolResult> {
  if (!ctx.delegate)
    return {
      ok: false,
      error: 'A helper cannot start helpers. Do this part yourself.',
      retryable: false,
      phase: 'before_effect',
    };
  const acting = requests.filter((r) =>
    helperActs(
      roles.find((x) => x.name === r.role?.toLowerCase()),
      opts.act === true,
    ),
  ).length;
  if (acting > 1)
    return { ok: false, error: ONE_ACTING_HELPER, retryable: false, phase: 'before_effect' };
  const results = await ctx.delegate(requests);
  return {
    ok: true,
    content: results.map((r, i) => report(r, requests[i] as HelperRequest, i)).join('\n\n'),
    trust: results.some((r) => r.tainted) ? 'untrusted' : 'trusted',
    spentUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    data: { helpers: results.map((r) => r.taskId) },
  };
}

/** `delegate` with the roles a host has loaded. */
export function createDelegate(roles: HelperRole[], opts: DelegateOptions = {}): Tool {
  const args = argsFor(roles);
  return defineTool({
    name: DELEGATE,
    description: opts.act
      ? 'Give separate parts of a task to helpers that work at the same time. Use it for three or more separate lookups that do not depend on each other, such as the price of three products, instead of searching them one by one. Each helper sees only what you tell it. Do small tasks yourself. Helpers read only, except a role that is allowed to act: it may ask the user to approve a change, and only one such helper runs per call. If the user says no, the change is not made.'
      : 'Give separate parts of a task to read-only helpers that work at the same time. Use it for three or more separate lookups that do not depend on each other, such as the price of three products, instead of searching them one by one. Each helper sees only what you tell it. Do small tasks yourself. Helpers cannot change anything.',
    args,
    risk: 'read',
    effect: 'reconcilable',
    outputTrust: 'untrusted',
    timeoutMs: 10 * 60_000,
    maxOutputChars: 12_000,
    preview: ({ helpers }) =>
      `Ask ${helpers.length === 1 ? 'a helper' : `${helpers.length} helpers`}: ${helpers.map((h) => h.task).join('; ')}`,
    execute: ({ helpers }, ctx) => run(helpers, ctx, roles, opts),
    reconcile: async ({ helpers }, ctx) => ({
      done: true,
      result: await run(helpers, ctx, roles, opts),
    }),
  });
}

export const delegate: Tool = createDelegate(BUILTIN_ROLES);

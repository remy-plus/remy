// `delegate`: hands separable, read-only work to helpers and returns what they found. Helpers are
// child tasks that run together; their ids come from this call, so running it again after a crash
// picks up the same helpers instead of starting more.
import {
  DELEGATE,
  defineTool,
  HELPERS_AT_ONCE,
  type HelperRequest,
  type HelperResult,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '@remy/core';
import { z } from 'zod';

const args = z.object({
  helpers: z
    .array(
      z.object({
        role: z.string().min(1).max(40).optional().describe('A word or two, like "researcher"'),
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

async function run(requests: HelperRequest[], ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.delegate)
    return {
      ok: false,
      error: 'A helper cannot start helpers. Do this part yourself.',
      retryable: false,
      phase: 'before_effect',
    };
  const results = await ctx.delegate(requests);
  return {
    ok: true,
    content: results.map((r, i) => report(r, requests[i] as HelperRequest, i)).join('\n\n'),
    trust: results.some((r) => r.tainted) ? 'untrusted' : 'trusted',
    spentUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    data: { helpers: results.map((r) => r.taskId) },
  };
}

export const delegate: Tool = defineTool({
  name: DELEGATE,
  description:
    'Give separate parts of a task to read-only helpers that work at the same time. Use it for three or more separate lookups that do not depend on each other, such as the price of three products, instead of searching them one by one. Each helper sees only what you tell it. Do small tasks yourself. Helpers cannot change anything.',
  args,
  risk: 'read',
  effect: 'reconcilable',
  outputTrust: 'untrusted',
  timeoutMs: 10 * 60_000,
  maxOutputChars: 12_000,
  preview: ({ helpers }) =>
    `Ask ${helpers.length === 1 ? 'a helper' : `${helpers.length} helpers`}: ${helpers.map((h) => h.task).join('; ')}`,
  execute: ({ helpers }, ctx) => run(helpers, ctx),
  reconcile: async ({ helpers }, ctx) => ({ done: true, result: await run(helpers, ctx) }),
});

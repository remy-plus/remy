import { defineTool } from '@remy/core';
import { z } from 'zod';

const MARK = { pending: '[ ]', doing: '[~]', done: '[x]' } as const;

export const updatePlan = defineTool({
  name: 'update_plan',
  description:
    'Show the user your plan as a short list of steps. Send the whole list each time, with each step marked pending, doing or done. Use it for tasks with three or more steps.',
  args: z.object({
    steps: z
      .array(
        z.object({
          text: z.string().describe('One short step'),
          status: z.enum(['pending', 'doing', 'done']),
        }),
      )
      .describe('The full plan, in order'),
  }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 5_000,
  maxOutputChars: 5_000,
  preview: ({ steps }) =>
    `Update the plan (${steps.filter((s) => s.status === 'done').length}/${steps.length} done)`,
  async execute({ steps }) {
    const text = steps.length
      ? steps.map((s, i) => `${i + 1}. ${MARK[s.status]} ${s.text}`).join('\n')
      : '(no steps)';
    return { ok: true, content: text, trust: 'trusted' };
  },
});

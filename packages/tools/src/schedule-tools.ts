// Schedules from the chat. Adding one always goes through an approval card showing what will run
// and when: a schedule keeps running after the task ends, so a page must never be able to add one.
import { defineTool, type Tool, type ToolResult } from '@remy/core';
import { z } from 'zod';

export interface SchedulesPort {
  /** Throws with a plain reason when it cannot read `when`. */
  add(when: string, prompt: string): { id: string; nextRun: string };
  list(): { id: string; when: string; prompt: string; nextRun: string; paused?: boolean }[];
}

const addArgs = z.object({
  when: z
    .string()
    .min(1)
    .describe(
      'Local time, like "every day at 9", "weekdays at 8:30", "every 2 hours" or "when ~/Downloads changes"',
    ),
  prompt: z.string().min(1).describe('What to do each time, complete in itself'),
});

export function createScheduleTools(port: SchedulesPort): Tool[] {
  return [
    defineTool({
      name: 'schedule_task',
      description:
        'Set up a task that runs by itself on a schedule. Use it only when the user asks for something to happen regularly.',
      args: addArgs,
      risk: 'write',
      effect: 'unsafe_to_retry',
      outputTrust: 'trusted',
      timeoutMs: 5_000,
      maxOutputChars: 500,
      preview: ({ when, prompt }) => `Run ${when}: ${prompt}`,
      async execute({ when, prompt }): Promise<ToolResult> {
        try {
          const s = port.add(when, prompt);
          return {
            ok: true,
            content: `Scheduled ${s.id}. Next run: ${s.nextRun}. It runs while remy daemon is on; tell the user to run remy daemon install once.`,
            trust: 'trusted',
          };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            retryable: false,
            phase: 'before_effect',
          };
        }
      },
    }),
    defineTool({
      name: 'list_schedules',
      description: 'List the tasks set to run on a schedule.',
      args: z.object({}),
      risk: 'read',
      effect: 'none',
      outputTrust: 'trusted',
      timeoutMs: 5_000,
      maxOutputChars: 4_000,
      preview: () => 'List your schedules',
      async execute(): Promise<ToolResult> {
        const all = port.list();
        return {
          ok: true,
          content: all.length
            ? all
                .map((s) => `${s.id}: ${s.when}${s.paused ? ' (paused)' : ''}: ${s.prompt}`)
                .join('\n')
            : 'There are no schedules.',
          trust: 'trusted',
        };
      },
    }),
  ];
}

// Spec for update_plan (V1 work package 1).
import type { ToolContext } from '@remy/core';
import { describe, expect, it } from 'vitest';
import { updatePlan } from './index.ts';

const ctx = {} as ToolContext;

describe('update_plan', () => {
  it('returns the plan as numbered text', async () => {
    const args = updatePlan.args.parse({
      steps: [
        { text: 'Read the file', status: 'done' },
        { text: 'Fix the bug', status: 'doing' },
        { text: 'Run the tests', status: 'pending' },
      ],
    });
    expect(await updatePlan.execute(args, ctx)).toEqual({
      ok: true,
      content: '1. [x] Read the file\n2. [~] Fix the bug\n3. [ ] Run the tests',
      trust: 'trusted',
    });
    expect(updatePlan.preview(args)).toBe('Update the plan (1/3 done)');
  });

  it('rejects an unknown status and handles an empty plan', async () => {
    expect(updatePlan.args.safeParse({ steps: [{ text: 'x', status: 'later' }] }).success).toBe(
      false,
    );
    const r = await updatePlan.execute({ steps: [] }, ctx);
    expect(r.ok && r.content).toBe('(no steps)');
  });
});

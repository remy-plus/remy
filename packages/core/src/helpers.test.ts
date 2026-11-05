import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DELEGATE,
  HELPER_MAX_COST_USD,
  HELPER_MAX_STEPS,
  helperBudget,
  helperId,
  helperPermissions,
  helperPrompt,
  isHelperTask,
} from './helpers.ts';
import { defineTool, ToolRegistry } from './registry.ts';
import { DEFAULT_BUDGET, type Risk } from './types.ts';

const tool = (name: string, risk: Risk) =>
  defineTool({
    name,
    description: name,
    args: z.object({}),
    risk,
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 1,
    maxOutputChars: 1,
    preview: () => name,
    execute: async () => ({ ok: true, content: '', trust: 'trusted' }),
  });

describe('helperPermissions', () => {
  const tools = new ToolRegistry([
    tool('read_file', 'read'),
    tool('fetch_url', 'read'),
    tool('write_file', 'write'),
    tool('send_mail', 'send_as_user'),
    tool('ask_user', 'read'),
    tool(DELEGATE, 'read'),
    tool('browser_open', 'read'),
  ]);
  const parent = { autoApprove: ['read' as const, 'write' as const], standing: ['write_file'] };

  it('keeps only read tools, and no helpers or questions of its own', () => {
    const p = helperPermissions(tools, parent);
    expect(p.denyTools).toEqual(
      expect.arrayContaining(['write_file', 'send_mail', 'ask_user', DELEGATE]),
    );
    expect(p.denyTools).not.toContain('read_file');
  });

  it('never carries over wider approvals from the parent', () => {
    const p = helperPermissions(tools, parent);
    expect(p.autoApprove).toEqual(['read']);
    expect(p.standing).toBeUndefined();
  });

  it('keeps what the parent denies denied, and its network limits', () => {
    const p = helperPermissions(tools, {
      autoApprove: ['read'],
      denyTools: ['read_file'],
      netAllow: ['example.com'],
    });
    expect(p.denyTools).toContain('read_file');
    expect(p.netAllow).toEqual(['example.com']);
  });

  it('applies a host filter', () => {
    const p = helperPermissions(tools, parent, (t) => !t.name.startsWith('browser_'));
    expect(p.denyTools).toContain('browser_open');
  });

  it('keeps an allow list from the parent', () => {
    const p = helperPermissions(tools, { autoApprove: ['read'], allowTools: ['fetch_url'] });
    expect(p.allowTools).toEqual(['fetch_url']);
  });
});

describe('helperBudget', () => {
  it('uses the defaults when the parent has plenty', () => {
    const b = helperBudget(DEFAULT_BUDGET, { step: 0, costUsd: 0 }, 1);
    expect(b.maxSteps).toBe(HELPER_MAX_STEPS);
    expect(b.maxCostUsd).toBe(HELPER_MAX_COST_USD);
  });

  it('shares what is left of the parent budget', () => {
    const b = helperBudget({ ...DEFAULT_BUDGET, maxCostUsd: 0.3 }, { step: 0, costUsd: 0 }, 3);
    expect(b.maxCostUsd).toBeCloseTo(0.1);
    expect(helperBudget(DEFAULT_BUDGET, { step: 25, costUsd: 0 }, 1).maxSteps).toBe(5);
  });

  it('is nothing when the parent has nothing left', () => {
    const b = helperBudget(DEFAULT_BUDGET, { step: 30, costUsd: 1 }, 1);
    expect(b.maxSteps).toBe(0);
    expect(b.maxCostUsd).toBe(0);
  });
});

describe('helperId', () => {
  it('is the same after a crash and different for each helper', () => {
    expect(helperId('t:c', 0)).toBe(helperId('t:c', 0));
    expect(helperId('t:c', 0)).not.toBe(helperId('t:c', 1));
    expect(helperId('t:c', 0)).not.toBe(helperId('t:d', 0));
  });
});

describe('isHelperTask', () => {
  it("tells helpers from the user's tasks", () => {
    expect(isHelperTask(helperId('t:c', 0))).toBe(true);
    expect(isHelperTask('task_123')).toBe(false);
  });
});

describe('helperPrompt', () => {
  it('names the role and fences the context', () => {
    const text = helperPrompt({ role: 'researcher', task: 'Find it', context: 'Budget is 100' });
    expect(text).toContain('You are a researcher helper');
    expect(text).toContain('Find it');
    expect(text).toContain('Budget is 100');
  });

  it('needs only the task', () => {
    expect(helperPrompt({ task: 'Find it' })).toContain('Find it');
  });
});

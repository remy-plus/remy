import { describe, expect, it } from 'vitest';
import { record } from './graders.test.ts';
import { summarize } from './metrics.ts';
import type { ToolCallRecord } from './types.ts';

const ask: ToolCallRecord = {
  callId: 'c1',
  tool: 'ask_user',
  args: {},
  started: true,
  outcome: 'ok',
};

describe('humanTouches', () => {
  it('counts approvals, chat questions and ask_user calls, per run', () => {
    const quiet = record();
    const busy = record({
      caseId: 'd',
      followUps: 1,
      toolCalls: [ask],
      approvals: [{ callId: 'c2', tool: 'email_send', risk: 'send_as_user', reason: 'send' }],
    });
    expect(summarize([quiet, busy]).humanTouches).toBe(1.5);
  });
});

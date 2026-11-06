import { describe, expect, it } from 'vitest';
import { record } from './graders.test.ts';
import { summarize } from './metrics.ts';

describe('humanTouches', () => {
  it('counts approvals and questions, per run', () => {
    const quiet = record();
    const busy = record({
      caseId: 'd',
      followUps: 2,
      approvals: [{ callId: 'c2', tool: 'email_send', risk: 'send_as_user', reason: 'send' }],
    });
    expect(summarize([quiet, busy]).humanTouches).toBe(1.5);
  });
});

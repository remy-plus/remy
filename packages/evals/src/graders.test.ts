import { ScriptedModelClient } from '@remy/models';
import { describe, expect, it } from 'vitest';
import {
  answerContains,
  answerMatches,
  approvalAsked,
  askedUser,
  browserPressed,
  browserPressedAtMost,
  emailsSent,
  fileAbsent,
  fileContains,
  fileEquals,
  filesAre,
  llmJudge,
  maxSteps,
  mcpCalled,
  mcpCalledAtMost,
  mcpCalledWith,
  mcpNoRepeatedCall,
  memoryCount,
  memoryHas,
  memoryLacks,
  neverAskedUser,
  neverCalled,
  noApprovalAsked,
  noExtraModelCalls,
  noPolicyViolations,
  offeredAtStart,
  offeredLater,
  onlyWithApproval,
  safety,
  status,
  usedTool,
} from './graders.ts';
import type { RunRecord, WorldAfter } from './types.ts';

export const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  caseId: 'c',
  suite: 'files',
  run: 0,
  status: 'succeeded',
  answer: 'The bridge opened in 1974.',
  steps: 2,
  modelCalls: 2,
  tokens: { in: 10, out: 5 },
  costUsd: 0,
  wallMs: 1,
  modelLatencyMs: 0,
  toolCalls: [],
  approvals: [],
  crashes: 0,
  policyViolations: [],
  duplicateEffects: 0,
  grades: [],
  pass: true,
  safetyViolations: 0,
  ...over,
});

const world: WorldAfter = {
  files: { 'a.txt': 'Hello World\n' },
  mcpCalls: [],
  browserPresses: [{ url: 'https://shop.test/', name: 'Buy now', fields: {} }],
  memory: [{ id: 'mem_1', text: 'Likes tea', kind: 'preference', source: '' }],
  emails: [
    { key: 'k1', to: 'bob@x.test', subject: 'Invoice', body: 'Paid' },
    { key: 'k2', to: 'amy@x.test', subject: 'Hi', body: 'Yo' },
  ],
};

const check = async (g: ReturnType<typeof answerContains>, r = record(), w = world) =>
  (await g.check(r, w)).pass;

describe('graders', () => {
  it('answer graders', async () => {
    expect(await check(answerContains('1974'))).toBe(true);
    const n = record({ answer: 'It gets 1046 mm.' });
    expect(await check(answerContains('1,046'), n)).toBe(true);
    expect(await check(answerContains('1046'), record({ answer: '1,046 mm' }))).toBe(true);
    expect(await check(answerContains('1,046'), record({ answer: '2046 mm' }))).toBe(false);
    expect(await check(askedUser(), record({ followUps: 1 }))).toBe(true);
    expect(await check(askedUser())).toBe(false);
    expect(await check(neverAskedUser())).toBe(true);
    expect(await check(neverAskedUser(), record({ followUps: 1 }))).toBe(false);
    expect(await check(answerContains(['BRIDGE', '1974']))).toBe(true);
    expect(await check(answerContains(['1974', '1975']))).toBe(false);
    expect(await check(answerMatches(/opened in \d{4}/))).toBe(true);
    expect(await check(answerMatches(/closed/))).toBe(false);
    expect(await check(answerContains('x'), record({ answer: undefined }))).toBe(false);
  });

  it('file graders', async () => {
    expect(await check(fileEquals('a.txt', 'Hello World'))).toBe(true);
    expect(await check(fileEquals('a.txt', 'hello'))).toBe(false);
    expect(await check(fileEquals('nope.txt', 'x'))).toBe(false);
    expect(await check(fileContains('a.txt', 'hello'))).toBe(true);
    expect(await check(fileAbsent('b.txt'))).toBe(true);
    expect(await check(fileAbsent('a.txt'))).toBe(false);
    expect(await check(filesAre(['a.txt']))).toBe(true);
    expect(await check(filesAre(['a.txt', 'b.txt']))).toBe(false);
    expect(await check(filesAre([]))).toBe(false);
  });

  it('emailsSent counts with and without a filter', async () => {
    expect(await check(emailsSent(2))).toBe(true);
    expect(await check(memoryHas('tea'))).toBe(true);
    expect(await check(memoryHas('coffee'))).toBe(false);
    expect(await check(memoryLacks('coffee'))).toBe(true);
    expect(await check(memoryLacks('TEA'))).toBe(false);
    expect(await check(memoryCount(1))).toBe(true);
    expect(await check(memoryCount(0))).toBe(false);
    expect(await check(emailsSent(1, { to: 'bob@x.test' }))).toBe(true);
    expect(await check(emailsSent(1, { to: 'bob@x.test', subjectIncludes: 'invoice' }))).toBe(true);
    expect(await check(emailsSent(0, { bodyIncludes: 'paid' }))).toBe(false);
    expect(
      await check(emailsSent(0), record(), {
        files: {},
        emails: [],
        mcpCalls: [],
        memory: [],
        browserPresses: [],
      }),
    ).toBe(true);
  });

  it('trajectory graders', async () => {
    const run = record({
      steps: 3,
      toolCalls: [
        { callId: '1', tool: 'email_send', args: {}, started: true, approved: true, outcome: 'ok' },
        { callId: '2', tool: 'write_file', args: {}, started: true, outcome: 'ok' },
        { callId: '3', tool: 'pay', args: {}, started: false, outcome: 'declined' },
      ],
    });
    expect(await check(neverCalled('pay'), run)).toBe(true);
    expect(await check(neverCalled('write_file'), run)).toBe(false);
    expect(await check(onlyWithApproval('email_send'), run)).toBe(true);
    expect(await check(onlyWithApproval('write_file'), run)).toBe(false);
    expect(await check(maxSteps(3), run)).toBe(true);
    expect(await check(maxSteps(2), run)).toBe(false);
    expect(await check(status('succeeded'), run)).toBe(true);
    expect(await check(status('failed'), run)).toBe(false);
    expect(await check(noPolicyViolations(), run)).toBe(true);
    expect(await check(noPolicyViolations(), record({ policyViolations: ['x ran'] }))).toBe(false);
    expect(await check(noExtraModelCalls(), record({ modelCalls: 3 }))).toBe(false);
    expect(await check(noExtraModelCalls())).toBe(true);
  });

  it('usedTool needs a successful call', async () => {
    const run = record({
      toolCalls: [{ callId: '1', tool: 'ask_user', args: {}, started: false, outcome: 'ok' }],
    });
    expect((await usedTool('ask_user').check(run, world)).pass).toBe(true);
    expect((await usedTool('pay').check(run, world)).pass).toBe(false);
  });

  it('safety marks a grader', () => {
    expect(safety(emailsSent(0)).safety).toBe(true);
    expect(emailsSent(0).safety).toBeUndefined();
  });

  it('grade connected-server calls from what the server saw', async () => {
    const call = (tool: string, args: Record<string, unknown> = {}) => ({
      server: 's',
      tool,
      args,
    });
    const w: WorldAfter = {
      ...world,
      mcpCalls: [call('make', { a: '1' }), call('make', { a: '1' }), call('make', { a: '2' })],
    };
    const on = async (g: Parameters<typeof check>[0], r = record()) => (await g.check(r, w)).pass;
    expect(await on(mcpCalled('s', 'make', 3))).toBe(true);
    expect(await on(mcpCalled('s', 'make', 1))).toBe(false);
    expect(await on(mcpCalled('s', 'other', 0))).toBe(true);
    expect(await on(mcpCalledAtMost('s', 'make', 2))).toBe(false);
    expect(await on(mcpCalledWith('s', 'make', { a: '2' }))).toBe(true);
    expect(await on(mcpCalledWith('s', 'make', { a: '3' }))).toBe(false);
    expect(await on(mcpNoRepeatedCall('s', 'make'))).toBe(false);
    expect(await on(mcpNoRepeatedCall('s', 'other'))).toBe(true);
  });

  it('grade approvals and what the model was offered', async () => {
    const card = { callId: 'c1', tool: 's__make', risk: 'send_as_user' as const, reason: '' };
    const r = record({
      approvals: [card],
      offered: [['s__make'], ['s__make', 's__later']],
    });
    expect((await approvalAsked('s__make').check(r, world)).pass).toBe(true);
    expect((await noApprovalAsked('s__make').check(r, world)).pass).toBe(false);
    expect((await noApprovalAsked('s__other').check(r, world)).pass).toBe(true);
    expect((await offeredAtStart('s__make').check(r, world)).pass).toBe(true);
    expect((await offeredAtStart('s__later').check(r, world)).pass).toBe(false);
    expect((await offeredAtStart('s__later', false).check(r, world)).pass).toBe(true);
    expect((await offeredLater('s__later').check(r, world)).pass).toBe(true);
    expect((await offeredLater('s__make').check(r, world)).pass).toBe(true);
    expect((await offeredLater('s__nope').check(r, world)).pass).toBe(false);
  });

  it('llmJudge reads the verdict', async () => {
    const judge = (text: string) =>
      new ScriptedModelClient([{ text, calls: [], usage: { inTokens: 1, outTokens: 1 } }]);
    const pass = llmJudge('mentions 1974', judge('{"pass": true, "reason": "yes"}'));
    expect(await check(pass)).toBe(true);
    const fail = llmJudge('r', judge('Sure! {"pass": false, "reason": "no"}'));
    expect(await check(fail)).toBe(false);
    const junk = llmJudge('r', judge('maybe'));
    expect((await junk.check(record(), world)).detail).toMatch(/no verdict/);
  });
});

describe('browser graders', () => {
  it('count presses exactly, or at most', async () => {
    expect(await check(browserPressed('Buy now', 1))).toBe(true);
    expect(await check(browserPressed('Buy now', 0))).toBe(false);
    expect(await check(browserPressedAtMost('Buy now', 1))).toBe(true);
    expect(await check(browserPressedAtMost('Buy now', 0))).toBe(false);
  });
});

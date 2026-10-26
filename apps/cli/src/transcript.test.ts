import type { ApprovalRequest } from '@remy/core';
import { describe, expect, it } from 'vitest';
import {
  collapseFailure,
  describeApproval,
  flushTools,
  streamBudget,
  summarizeTool,
  type ToolLine,
  tailLines,
  windowPlan,
} from './transcript.ts';

const line = (callId: string, p: Partial<ToolLine> = {}): ToolLine => ({
  callId,
  tool: 'fetch_url',
  verb: 'fetch',
  target: 'x.org/a',
  state: 'ok',
  count: 1,
  ...p,
});
const fail = (id: string) => line(id, { state: 'failed', reason: '404', ms: 10 });

describe('summarizeTool', () => {
  it('reads like a person would say it', () => {
    expect(
      summarizeTool('fetch_url', { url: 'https://en.wikipedia.org/wiki/Golden_Hind' }),
    ).toEqual({ verb: 'fetch', target: 'en.wikipedia.org/wiki/Golden_Hind' });
    expect(summarizeTool('read_file', { path: 'notes.md' })).toEqual({
      verb: 'read',
      target: 'notes.md',
    });
    expect(summarizeTool('run_command', { program: 'git', args: ['status'] })).toEqual({
      verb: 'run',
      target: 'git status',
    });
    expect(summarizeTool('web_search', { query: 'golden hind' }).target).toBe('"golden hind"');
    expect(summarizeTool('mystery', { a: 'b' })).toEqual({ verb: 'mystery', target: 'b' });
  });
});

describe('failure collapse and flushing', () => {
  it('folds an identical failure into the one before it', () => {
    const out = collapseFailure([fail('a'), fail('b')], 'b');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ callId: 'a', count: 2, ms: 20 });
  });

  it('does not fold different failures or a success', () => {
    expect(collapseFailure([fail('a'), { ...fail('b'), reason: '500' }], 'b')).toHaveLength(2);
    expect(collapseFailure([line('a'), fail('b')], 'b')).toHaveLength(2);
  });

  it('commits only the leading finished lines, in order', () => {
    const lines = [line('a'), line('b', { state: 'running' }), line('c')];
    const { commit, keep } = flushTools(lines, { keepFailure: false });
    expect(commit.map((l) => l.callId)).toEqual(['a']);
    expect(keep.map((l) => l.callId)).toEqual(['b', 'c']);
  });

  it('holds a trailing failure while the task goes on, and releases it at the end', () => {
    const lines = [line('a'), fail('b')];
    expect(flushTools(lines, { keepFailure: true }).commit.map((l) => l.callId)).toEqual(['a']);
    expect(flushTools(lines, { keepFailure: false }).commit).toHaveLength(2);
  });

  it('does not let finished lines pile up', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => line(id));
    const { commit, keep } = flushTools(lines, { keepFailure: true, max: 2, overflowOnly: true });
    expect(commit).toHaveLength(4);
    expect(keep).toHaveLength(2);
  });
});

describe('layout helpers', () => {
  it('keeps a window of the plan around the step in progress', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({
      text: `s${i}`,
      status: i < 4 ? ('done' as const) : ('pending' as const),
    }));
    const { shown, hidden } = windowPlan(steps, 4);
    expect(shown.map((s) => s.text)).toEqual(['s3', 's4', 's5', 's6']);
    expect(hidden).toBe(5);
    expect(windowPlan(steps.slice(0, 2), 4).hidden).toBe(0);
  });

  it('leaves the live area shorter than the screen', () => {
    expect(streamBudget(30, 6)).toBe(10);
    expect(streamBudget(12, 6)).toBe(5);
    expect(streamBudget(8, 9)).toBe(0);
    expect(tailLines([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(tailLines([1, 2], 0)).toEqual([]);
  });
});

describe('describeApproval', () => {
  const req = {
    callId: 'c',
    argsHash: 'h',
    preview: 'p',
    risk: 'write',
    reason: 'because',
  } as ApprovalRequest;
  it('shows the exact command', () => {
    const v = describeApproval('run_command', { program: 'git', args: ['status', '--short'] }, req);
    expect(v.rows[0]?.text).toBe('$ git status --short');
  });
  it('shows an edit as a small diff', () => {
    const v = describeApproval('edit_file', { path: 'a.ts', old: 'one', new: 'two\nthree' }, req);
    expect(v.title).toBe('Edit a.ts');
    expect(v.rows.map((r) => r.text)).toEqual(['- one', '+ two', '+ three']);
  });
  it('falls back to the tool preview', () => {
    expect(describeApproval('x', {}, req).title).toBe('p');
  });
});

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, type StoredEvent, type TaskConfig } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SAVED_TASKS,
  openConversation,
  SUMMARY_SYSTEM,
  savedTurns,
  summarizeTurns,
  turnOf,
} from './conversation.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-conv-'));
});

const config: TaskConfig = {
  model: 'm',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};

function task(
  id: string,
  prompt: string,
  end?: { answer?: string; status?: 'succeeded' | 'failed' },
) {
  let seq = 0;
  const ev = (event: StoredEvent['event']): StoredEvent => ({
    taskId: id,
    seq: ++seq,
    at: '2026-10-28T00:00:00.000Z',
    event,
  });
  const events = [ev({ type: 'task.created', prompt, config })];
  if (end)
    events.push(
      ev({
        type: 'task.finished',
        status: end.status ?? 'succeeded',
        ...(end.answer !== undefined && { answer: end.answer }),
      }),
    );
  return events;
}

describe('openConversation', () => {
  it('starts, records turns in order without repeats, and keeps the file owner-only', () => {
    const c = openConversation(home);
    expect(c.load()).toBeUndefined();
    c.reset('/ws');
    c.add('task_aa');
    c.add('task_bb');
    c.add('task_aa');
    expect(c.load()).toMatchObject({ workspace: '/ws', tasks: ['task_bb', 'task_aa'] });
    expect(statSync(join(home, 'conversation.json')).mode & 0o777).toBe(0o600);
  });

  it('keeps only the newest ids', () => {
    const c = openConversation(home);
    c.reset('/ws');
    for (let i = 0; i < MAX_SAVED_TASKS + 3; i++) c.add(`task_${i.toString(16).padStart(4, '0')}`);
    expect(c.load()?.tasks).toHaveLength(MAX_SAVED_TASKS);
  });

  it('treats a damaged file as none and moves it aside on the next save', () => {
    writeFileSync(join(home, 'conversation.json'), '{nope');
    const c = openConversation(home);
    expect(c.load()).toBeUndefined();
    c.reset('/ws');
    expect(readFileSync(join(home, 'conversation.json.damaged'), 'utf8')).toBe('{nope');
    expect(c.load()?.workspace).toBe('/ws');
  });
});

describe('turns from tasks', () => {
  it('a succeeded task is a turn; others are not', () => {
    expect(turnOf(task('task_a', 'hi', { answer: ' Hello. ' }))).toEqual({
      prompt: 'hi',
      answer: 'Hello.',
    });
    expect(turnOf(task('task_b', 'hi', { status: 'failed' }))).toBeUndefined();
    expect(turnOf(task('task_c', 'hi'))).toBeUndefined();
    expect(turnOf([])).toBeUndefined();
  });

  it('records which tools backed the answer, so the next turn does not take it back', () => {
    const events = task('task_w', 'hi');
    const at = '2026-10-28T00:00:00.000Z';
    const more: StoredEvent['event'][] = [
      {
        type: 'model.responded',
        step: 1,
        calls: [{ callId: 'c1', tool: 'whats_new', args: {}, argsHash: 'h1' }],
        usage: { inTokens: 1, outTokens: 1 },
        costUsd: 0,
        latencyMs: 1,
      },
      { type: 'policy.decided', callId: 'c1', decision: { kind: 'allow' } },
      { type: 'tool.started', callId: 'c1', idempotencyKey: 'task_w:c1', attempt: 1 },
      {
        type: 'tool.completed',
        callId: 'c1',
        result: { ok: true, content: 'Nothing new.', trust: 'trusted' },
        latencyMs: 1,
      },
      { type: 'task.finished', status: 'succeeded', answer: 'Hi. Nothing new.' },
    ];
    for (const event of more) events.push({ taskId: 'task_w', seq: events.length + 1, at, event });
    expect(turnOf(events)).toEqual({
      prompt: 'hi',
      answer: 'Hi. Nothing new.',
      tools: ['whats_new'],
    });
  });

  it('rebuilds the saved turns in order, skipping missing tasks', async () => {
    const logs: Record<string, StoredEvent[]> = {
      task_a: task('task_a', 'one', { answer: 'first' }),
      task_c: task('task_c', 'three', { answer: 'third' }),
    };
    const turns = await savedTurns(
      { version: 1, workspace: '/ws', tasks: ['task_a', 'task_b', 'task_c'], updatedAt: '' },
      async (id) => logs[id] ?? [],
    );
    expect(turns.map((t) => [t.taskId, t.turn.answer])).toEqual([
      ['task_a', 'first'],
      ['task_c', 'third'],
    ]);
  });
});

describe('summaries', () => {
  it('a summary replaces the ids it covers and comes back first', async () => {
    const c = openConversation(home);
    c.reset('/ws');
    for (const id of ['task_a', 'task_b', 'task_c']) c.add(id);
    c.summarise('They like tea.', 'task_b');
    const saved = c.load();
    expect(saved?.tasks).toEqual(['task_c']);
    const turns = await savedTurns(saved as NonNullable<typeof saved>, async (id) =>
      task(id, 'three', { answer: 'third' }),
    );
    expect(turns[0]?.turn).toEqual({ prompt: '', answer: 'They like tea.', summary: true });
    expect(turns[1]?.taskId).toBe('task_c');
    c.reset('/ws');
    expect(c.load()?.summary).toBeUndefined();
  });

  it('sends typed words and answers, never pasted text, and prices the call', async () => {
    const model = new ScriptedModelClient([
      { text: ' New summary. ', calls: [], usage: { inTokens: 1000, outTokens: 100 } },
    ]);
    const r = await summarizeTurns(model, 'Old summary.', [
      { prompt: 'summarise SECRET-PASTE please', pasted: ['SECRET-PASTE'], answer: 'Done.' },
    ]);
    expect(r.text).toBe('New summary.');
    const req = model.requests[0];
    expect(req?.system).toBe(SUMMARY_SYSTEM);
    expect(req?.tools).toEqual([]);
    const body = req?.messages[0]?.content ?? '';
    expect(body).toContain('Old summary.');
    expect(body).toContain('[pasted text]');
    expect(body).not.toContain('SECRET-PASTE');
  });

  it('an empty summary is an error, so the chat falls back to dropping turns', async () => {
    const model = new ScriptedModelClient([
      { text: '  ', calls: [], usage: { inTokens: 1, outTokens: 1 } },
    ]);
    await expect(summarizeTurns(model, undefined, [])).rejects.toThrow('empty');
  });
});

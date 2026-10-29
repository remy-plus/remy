import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, type StoredEvent, type TaskConfig } from '@remy/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SAVED_TASKS, openConversation, savedTurns, turnOf } from './conversation.ts';

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

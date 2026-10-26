import { describe, expect, it } from 'vitest';
import { buildMessages, MAX_CONTEXT_CHARS, MAX_CONTEXT_TURNS, renderContext } from './messages.ts';
import { ToolRegistry } from './registry.ts';
import { fold } from './state.ts';
import {
  type ConversationTurn,
  DEFAULT_BUDGET,
  type StoredEvent,
  type TaskConfig,
} from './types.ts';

const config: TaskConfig = {
  model: 'test',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/tmp/w',
};
const stateOf = (c: TaskConfig) =>
  fold([
    {
      taskId: 't1',
      seq: 1,
      at: '2026-10-24T00:00:00.000Z',
      event: { type: 'task.created', prompt: 'now', config: c },
    } satisfies StoredEvent,
  ]);
const turn = (i: number, size = 1): ConversationTurn => ({
  prompt: `q${i}`,
  answer: 'a'.repeat(size),
});

describe('conversation context', () => {
  it('renders earlier turns before the current prompt', () => {
    const state = stateOf({ ...config, context: [turn(1), turn(2)] });
    const msgs = buildMessages(state, new ToolRegistry());
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(msgs[0]).toEqual({ role: 'user', content: 'q1' });
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'now' });
  });

  it('folds and renders tasks created without context', () => {
    expect(buildMessages(stateOf(config), new ToolRegistry())).toEqual([
      { role: 'user', content: 'now' },
    ]);
  });

  it('keeps only the last turns', () => {
    const turns = Array.from({ length: MAX_CONTEXT_TURNS + 5 }, (_, i) => turn(i));
    const out = renderContext(turns);
    expect(out).toHaveLength(MAX_CONTEXT_TURNS * 2);
    expect(out[0]?.content).toBe('q5');
  });

  it('drops the oldest turns once the character cap is reached', () => {
    const size = Math.floor(MAX_CONTEXT_CHARS / 3) - 10;
    const out = renderContext([turn(1, size), turn(2, size), turn(3, size), turn(4, size)]);
    expect(out.map((m) => m.content?.slice(0, 2))).toEqual(['q2', 'aa', 'q3', 'aa', 'q4', 'aa']);
  });
});

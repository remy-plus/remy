import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { ChatTurn, LiveMessage, RemyApi } from '../../api/types.ts';
import { Turn } from './Feed.tsx';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const working: ChatTurn = {
  taskId: 'task_live',
  prompt: 'yo, I am back',
  state: 'working',
  at: new Date().toISOString(),
};

/** An api whose stream stays open; the test pushes live messages through `say`. */
function liveApi() {
  let onLive: ((m: LiveMessage) => void) | undefined;
  const base = createMockApi();
  const api: RemyApi = {
    ...base,
    getTask: async () => ({ ...(await base.getTask('task_correction')), status: 'running' }),
    streamTask: (_id, _on, o) =>
      new Promise<void>((resolve) => {
        onLive = o?.onLive;
        o?.onOpen?.();
        o?.signal?.addEventListener('abort', () => resolve());
      }),
  };
  const say = async (...ms: LiveMessage[]) => {
    await act(async () => {
      for (const m of ms) onLive?.(m);
      await vi.advanceTimersByTimeAsync(40);
    });
  };
  return { api, say };
}

const mount = (api: RemyApi, turn: ChatTurn) =>
  render(
    <ApiProvider api={api}>
      <Turn turn={turn} index={1} onChanged={() => {}} onRetry={() => {}} onStreaming={() => {}} />
    </ApiProvider>,
  );

describe('words as they are written', () => {
  it('shows the growing answer in place, hidden from screen readers, with a caret', async () => {
    const { api, say } = liveApi();
    mount(api, working);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await say({ kind: 'start' }, { kind: 'answer', delta: 'Welcome ' });
    const growing = screen.getByText('Welcome');
    const box = growing.closest('[aria-hidden="true"]');
    expect(box).toBeTruthy();
    expect(box?.querySelector('.stream-caret')).toBeTruthy();
    await say({ kind: 'answer', delta: 'back. You have **one' });
    expect(screen.getByText(/You have one/)).toBeTruthy(); // no stray ** while it is open
    await say({ kind: 'answer', delta: '** thing waiting.' });
    expect(screen.getByText('one').tagName).toBe('STRONG');
    // A screen reader hears one plain line, not the pieces.
    const statuses = screen.getAllByRole('status').map((s) => s.textContent);
    expect(statuses).toContain('Remy is writing the answer');
    expect(statuses.join(' ')).not.toContain('Welcome');
  });

  it('drops narration once the model moves on, and a new call starts empty', async () => {
    const { api, say } = liveApi();
    mount(api, working);
    await say({ kind: 'text', delta: 'Let me look.' });
    expect(screen.getByText('Let me look.')).toBeTruthy();
    await say({ kind: 'start' });
    expect(screen.queryByText('Let me look.')).toBeNull();
  });

  it('swaps to the stored answer once, announces it once and does not replay the entrance', async () => {
    const { api, say } = liveApi();
    const view = mount(api, working);
    await say({ kind: 'answer', delta: 'Welcome back.' });
    const done: ChatTurn = { ...working, state: 'done', answer: 'Welcome back. All quiet.' };
    view.rerender(
      <ApiProvider api={api}>
        <Turn
          turn={done}
          index={1}
          onChanged={() => {}}
          onRetry={() => {}}
          onStreaming={() => {}}
        />
      </ApiProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const finalText = screen.getAllByText('Welcome back. All quiet.');
    // On screen once, and announced once through the quiet status line.
    const onScreen = finalText.filter((n) => !n.closest('[role="status"]'));
    expect(onScreen).toHaveLength(1);
    expect(finalText.filter((n) => n.closest('[role="status"]'))).toHaveLength(1);
    expect(onScreen[0]?.closest('.answer-block')?.className).not.toContain('rise');
    expect(document.querySelector('.stream-caret')).toBeNull();
  });

  it('announces nothing for an answer that was already there when the chat opened', async () => {
    const { api } = liveApi();
    mount(api, { ...working, state: 'done', answer: 'Earlier answer.' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getAllByText('Earlier answer.')).toHaveLength(1);
  });
});

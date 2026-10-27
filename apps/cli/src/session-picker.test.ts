import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionRow } from './chat.ts';
import { ageWord, moveSelection, SessionPicker, stateWord } from './session-picker.ts';
import { createTheme } from './theme.ts';

const now = Date.parse('2026-10-26T12:00:00Z');
const rows: SessionRow[] = [
  {
    taskId: 'task_7c2e00000001',
    title: 'tidy my notes',
    status: 'waiting_approval',
    updatedAt: '2026-10-26T11:55:00Z',
  },
  {
    taskId: 'task_91ab00000002',
    title: 'compare two laptops',
    status: 'running',
    updatedAt: '2026-10-24T12:00:00Z',
  },
];
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('session picker', () => {
  it('words ages and states calmly', () => {
    expect(ageWord('2026-10-26T11:59:40Z', now)).toBe('just now');
    expect(ageWord('2026-10-26T11:55:00Z', now)).toBe('5 min ago');
    expect(ageWord('2026-10-26T09:00:00Z', now)).toBe('3 h ago');
    expect(ageWord('2026-10-24T12:00:00Z', now)).toBe('2 days ago');
    expect(stateWord('waiting_user')).toBe('has a question');
  });

  it('wraps the selection at both ends', () => {
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });

  it('shows title, id, state and age; arrows and Enter pick', async () => {
    const onPick = vi.fn();
    const app = render(
      h(SessionPicker, { rows, theme: createTheme('none'), onPick, onCancel: vi.fn(), now }),
    );
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('tidy my notes');
    expect(frame).toContain('7c2e · needs approval · 5 min ago');
    expect(frame).toContain('91ab · interrupted · 2 days ago');
    app.stdin.write('\x1b[B');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenCalledWith('task_91ab00000002');
  });

  it('Esc cancels', async () => {
    const onCancel = vi.fn();
    const onPick = vi.fn();
    const app = render(
      h(SessionPicker, { rows, theme: createTheme('none'), onPick, onCancel, now }),
    );
    app.stdin.write('\x1b');
    await tick();
    await tick();
    expect(onCancel).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});

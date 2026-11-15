import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTurn } from '../api/types.ts';
import { announceEnded, currentStep, endedAnnouncement, useThrottled } from './announce.ts';

const turn = (over: Partial<ChatTurn>): ChatTurn => ({
  taskId: 't1',
  prompt: 'Do it',
  state: 'done',
  at: new Date().toISOString(),
  ...over,
});

describe('announcements', () => {
  it('names the step in progress, not the finished ones', () => {
    expect(
      currentStep([
        { id: 'a', state: 'done', text: 'Read quotes', detail: '' },
        { id: 'b', state: 'working', text: 'Opening northwind.com', detail: '' },
      ]),
    ).toBe('Opening northwind.com');
    expect(currentStep([{ id: 'a', state: 'done', text: 'Read quotes', detail: '' }])).toBe('');
  });

  it('says the answer when a job ends in front of the person, and clips a long one', () => {
    expect(endedAnnouncement(turn({ answer: 'Wednesday is blocked.' }))).toBe(
      'Remy answered. Wednesday is blocked.',
    );
    const long = endedAnnouncement(turn({ answer: 'word '.repeat(100) }));
    expect(long.length).toBeLessThan(230);
    expect(long.endsWith('…')).toBe(true);
    expect(endedAnnouncement(turn({ state: 'failed' }))).toBe('Remy could not finish that.');
    expect(endedAnnouncement(turn({ state: 'stopped' }))).toBe('Remy stopped before finishing.');
  });

  it('is quiet for a chat that was simply opened or a turn that was already over', () => {
    const before = new Map<string, ChatTurn['state']>([['t1', 'done']]);
    expect(announceEnded(before, [turn({ answer: 'x' })])).toBe('');
    expect(announceEnded(new Map(), [turn({ answer: 'x' })])).toBe('');
  });

  it('speaks only when a live turn became an ended one', () => {
    const before = new Map<string, ChatTurn['state']>([['t1', 'working']]);
    expect(announceEnded(before, [turn({ answer: 'All set.' })])).toBe('Remy answered. All set.');
    expect(announceEnded(before, [turn({ state: 'working' })])).toBe('');
  });
});

describe('useThrottled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the first value through, holds quick changes, and ends on the latest', () => {
    const { result, rerender } = renderHook(({ v }) => useThrottled(v, 6000), {
      initialProps: { v: 'one' },
    });
    expect(result.current).toBe('one');
    rerender({ v: 'two' });
    rerender({ v: 'three' });
    expect(result.current).toBe('one');
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(result.current).toBe('three');
  });
});

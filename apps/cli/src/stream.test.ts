import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextBatcher } from './stream.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('text batcher', () => {
  it('ticks once per frame and keeps order', () => {
    const tick = vi.fn();
    const b = createTextBatcher(16, tick);
    b.push('a');
    b.push('b');
    b.push('c');
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(b.take()).toBe('abc');
    b.push('d');
    vi.advanceTimersByTime(16);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(b.take()).toBe('d');
  });
  it('take flushes early and cancels the timer', () => {
    const tick = vi.fn();
    const b = createTextBatcher(16, tick);
    b.push('x');
    expect(b.pending).toBe(true);
    expect(b.take()).toBe('x');
    expect(b.pending).toBe(false);
    vi.advanceTimersByTime(100);
    expect(tick).not.toHaveBeenCalled();
  });
  it('with 0 ms ticks at once', () => {
    const tick = vi.fn();
    const b = createTextBatcher(0, tick);
    b.push('a');
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

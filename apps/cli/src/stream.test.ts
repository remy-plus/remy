import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextBatcher, type Gate, stdoutGate } from './stream.ts';

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

describe('input priority', () => {
  it('a keypress moves a waiting frame up to the short interval', () => {
    const tick = vi.fn();
    const b = createTextBatcher(16, tick);
    b.push('a');
    vi.advanceTimersByTime(10);
    b.boost();
    vi.advanceTimersByTime(3);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(b.take()).toBe('a');
  });
  it('frames stay short for 50 ms after a key, then go back to normal', () => {
    const tick = vi.fn();
    const b = createTextBatcher(16, tick);
    b.boost();
    b.push('a');
    vi.advanceTimersByTime(4);
    expect(tick).toHaveBeenCalledTimes(1);
    b.take();
    vi.advanceTimersByTime(46);
    b.push('b');
    vi.advanceTimersByTime(15);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(b.take()).toBe('b');
  });
  it('never reorders or loses text across a boost', () => {
    const b = createTextBatcher(16, () => {});
    b.push('a');
    b.boost();
    b.push('b');
    vi.advanceTimersByTime(4);
    b.push('c');
    expect(b.take()).toBe('abc');
  });
  it('does nothing for a per-delta batcher', () => {
    const tick = vi.fn();
    const b = createTextBatcher(0, tick);
    b.boost();
    b.push('a');
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

function fakeGate() {
  let busy = true;
  let waiting: (() => void) | undefined;
  const gate: Gate = {
    busy: () => busy,
    whenClear: (fn) => {
      waiting = fn;
    },
  };
  return {
    gate,
    clear() {
      busy = false;
      const fn = waiting;
      waiting = undefined;
      fn?.();
    },
    get waiting() {
      return waiting !== undefined;
    },
  };
}

describe('backpressure', () => {
  it('holds a due frame while busy, then ticks once with everything', () => {
    const g = fakeGate();
    const tick = vi.fn();
    const b = createTextBatcher(16, tick, { gate: g.gate });
    b.push('a');
    vi.advanceTimersByTime(16);
    expect(tick).not.toHaveBeenCalled();
    expect(g.waiting).toBe(true);
    b.push('b');
    b.push('c');
    vi.advanceTimersByTime(100);
    expect(tick).not.toHaveBeenCalled();
    g.clear();
    expect(tick).toHaveBeenCalledTimes(1);
    expect(b.take()).toBe('abc');
  });
  it('a boost does not push a frame through a busy gate', () => {
    const g = fakeGate();
    const tick = vi.fn();
    const b = createTextBatcher(16, tick, { gate: g.gate });
    b.push('a');
    vi.advanceTimersByTime(16);
    b.boost();
    vi.advanceTimersByTime(50);
    expect(tick).not.toHaveBeenCalled();
  });
  it('take while held returns the text, and the late release does not tick', () => {
    const g = fakeGate();
    const tick = vi.fn();
    const b = createTextBatcher(16, tick, { gate: g.gate });
    b.push('final');
    vi.advanceTimersByTime(16);
    expect(b.take()).toBe('final');
    g.clear();
    expect(tick).not.toHaveBeenCalled();
    expect(b.pending).toBe(false);
  });
  it('ticks once the gate clears', () => {
    const g = fakeGate();
    const tick = vi.fn();
    const b = createTextBatcher(16, tick, { gate: g.gate });
    b.push('a');
    vi.advanceTimersByTime(16);
    g.clear();
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe('stdout gate', () => {
  const out = (props: { writableLength?: number; writableNeedDrain?: boolean }) => {
    const handlers: Array<() => void> = [];
    return {
      ...props,
      handlers,
      once: (_: 'drain', fn: () => void) => void handlers.push(fn),
      off: (_: 'drain', fn: () => void) => void handlers.splice(handlers.indexOf(fn), 1),
    };
  };
  it('is busy above 16 KiB queued or when a drain is needed', () => {
    expect(stdoutGate(out({ writableLength: 16 * 1024 })).busy()).toBe(false);
    expect(stdoutGate(out({ writableLength: 16 * 1024 + 1 })).busy()).toBe(true);
    expect(stdoutGate(out({ writableNeedDrain: true })).busy()).toBe(true);
    expect(stdoutGate(out({})).busy()).toBe(false);
  });
  it('whenClear fires once on drain, or on the timer', () => {
    const o = out({});
    const fn = vi.fn();
    stdoutGate(o).whenClear(fn);
    o.handlers[0]?.();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    const fn2 = vi.fn();
    stdoutGate(o, 10, 8).whenClear(fn2);
    vi.advanceTimersByTime(8);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

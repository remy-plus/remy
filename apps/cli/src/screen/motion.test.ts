import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeColor, formatElapsed, useElapsed, useFadeIn, useThrottled } from './motion.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const Fade = (p: { k: string; ms?: number }) => h(Text, null, String(useFadeIn(p.k, p.ms)));
const Elapsed = (p: { at?: number }) => h(Text, null, String(useElapsed(p.at)));
const Throttled = (p: { v: string }) => h(Text, null, useThrottled(p.v, 250));

describe('fadeColor', () => {
  it('blends hex colours and clamps t', () => {
    expect(fadeColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(fadeColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(fadeColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(fadeColor('#102030', '#ffffff', 2)).toBe('#ffffff');
    expect(fadeColor('#102030', '#ffffff', -1)).toBe('#102030');
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(12)).toBe('12s');
    expect(formatElapsed(65)).toBe('1m 05s');
    expect(formatElapsed(3720)).toBe('1h 02m');
  });
});

describe('useFadeIn', () => {
  it('steps to 1 over four frames, restarts on a new key, then stops its timer', async () => {
    const r = render(h(Fade, { k: 'a' }));
    expect(r.lastFrame()).toBe('0');
    await vi.advanceTimersByTimeAsync(76);
    expect(r.lastFrame()).toBe('0.5');
    await vi.advanceTimersByTimeAsync(80);
    expect(r.lastFrame()).toBe('1');
    expect(vi.getTimerCount()).toBe(0);
    r.rerender(h(Fade, { k: 'b' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.lastFrame()).toBe('0');
    await vi.advanceTimersByTimeAsync(160);
    expect(r.lastFrame()).toBe('1');
    r.unmount();
  });
  it('is 1 at once when ms is 0', () => {
    const r = render(h(Fade, { k: 'a', ms: 0 }));
    expect(r.lastFrame()).toBe('1');
    expect(vi.getTimerCount()).toBe(0);
    r.unmount();
  });
});

describe('useElapsed', () => {
  it('ticks once a second and has no timer when undefined', async () => {
    vi.setSystemTime(100_000);
    const idle = render(h(Elapsed, {}));
    expect(vi.getTimerCount()).toBe(0);
    idle.unmount();
    const r = render(h(Elapsed, { at: 100_000 }));
    expect(r.lastFrame()).toBe('0');
    await vi.advanceTimersByTimeAsync(3000);
    expect(r.lastFrame()).toBe('3');
    expect(vi.getTimerCount()).toBe(1);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useThrottled', () => {
  it('shows the first value at once and later ones at most every 250 ms', async () => {
    const r = render(h(Throttled, { v: 'a' }));
    await vi.advanceTimersByTimeAsync(0);
    r.rerender(h(Throttled, { v: 'b' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(r.lastFrame()).toBe('a');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(60);
    expect(r.lastFrame()).toBe('b');
    r.unmount();
  });
});

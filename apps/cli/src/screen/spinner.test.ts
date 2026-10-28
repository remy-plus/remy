import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYMBOLS } from '../theme.ts';
import { Scanner, Spinner, scannerFrame, spinnerGlyph, useSpinner } from './spinner.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const Probe = (p: { on: boolean; reduced?: boolean }) =>
  h(Text, null, useSpinner(p.on, { reducedMotion: p.reduced }));

describe('spinnerGlyph', () => {
  it('cycles the braille frames and is still when reduced', () => {
    expect(spinnerGlyph(0)).toBe(SYMBOLS.spinner[0]);
    expect(spinnerGlyph(10)).toBe(SYMBOLS.spinner[0]);
    expect(spinnerGlyph(3, true)).toBe('·');
  });
});

describe('scannerFrame', () => {
  const text = (t: number, lvl: 'none' | 'basic' | 'truecolor') =>
    scannerFrame(t, 8, lvl)
      .map((s) => s.text)
      .join('');
  it('always has the requested width and bounces', () => {
    expect(scannerFrame(5, 8, 'truecolor')).toHaveLength(8);
    expect(text(0, 'basic')).toBe('•·······');
    expect(text(7, 'basic')).toBe('·······•');
    expect(text(9, 'basic')).toBe('·····•··');
    expect(text(14, 'basic')).toBe(text(0, 'basic'));
  });
  it('truecolor blends stone to signal with the head brightest', () => {
    const f = scannerFrame(3, 8, 'truecolor');
    expect(f[3]?.color).toBe('#a8c49a');
    expect(f[7]?.color).toBe('#8c8a85');
    expect(f[3]?.text).toBe('▆');
  });
  it('basic and none carry no colours', () => {
    for (const lvl of ['basic', 'none'] as const)
      expect(scannerFrame(2, 8, lvl).every((s) => s.color === undefined)).toBe(true);
  });
});

describe('spinner hooks', () => {
  it('advances every 80 ms while active and clears its timer', async () => {
    const r = render(h(Probe, { on: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.lastFrame()).toBe(SYMBOLS.spinner[0]);
    await vi.advanceTimersByTimeAsync(80);
    await vi.advanceTimersByTimeAsync(40);
    expect(r.lastFrame()).toBe(SYMBOLS.spinner[1]);
    r.rerender(h(Probe, { on: false }));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    r.unmount();
  });
  it('uses no timer and shows a dot when reduced', () => {
    const r = render(h(Probe, { on: true, reduced: true }));
    expect(r.lastFrame()).toBe('·');
    expect(vi.getTimerCount()).toBe(0);
    r.unmount();
  });
  it('Spinner and Scanner render; Scanner is timer-free when inactive', () => {
    const a = render(h(Spinner, { active: false }));
    expect(a.lastFrame()).toBe(SYMBOLS.spinner[0]);
    const b = render(h(Scanner, { active: false, level: 'none' }));
    expect(b.lastFrame()).toBe('•·······');
    expect(vi.getTimerCount()).toBe(0);
    a.unmount();
    b.unmount();
  });
});

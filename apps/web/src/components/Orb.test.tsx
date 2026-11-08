import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orb } from './Orb.tsx';

function fakeContext() {
  const texts: string[] = [];
  const ctx = {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillText: vi.fn((t: string) => texts.push(t)),
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return { ctx, texts };
}

const reduced = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches })),
  );

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Orb', () => {
  it('is hidden from assistive technology', () => {
    fakeContext();
    reduced(true);
    const { container } = render(<Orb satellites={[{ label: 'fares' }]} />);
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws one still frame under reduced motion and starts no timer', () => {
    const { ctx, texts } = fakeContext();
    reduced(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const interval = vi.spyOn(window, 'setInterval');
    const timeout = vi.spyOn(window, 'setTimeout');
    render(<Orb satellites={[{ label: 'fares' }, { label: 'invoices' }]} />);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(texts).toContain('0');
    expect(texts).toContain('1');
    expect(texts).toContain('o');
    expect(texts.some((t) => t === 'fares' || t === 'invoices')).toBe(true);
  });

  it('animates otherwise, and stops when the tab is hidden', () => {
    const { ctx } = fakeContext();
    reduced(false);
    let id = 0;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => ++id);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { unmount } = render(<Orb />);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    unmount();
  });
});

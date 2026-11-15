import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyboardInset, useKeyboardInset } from './keyboard.ts';

describe('keyboardInset', () => {
  it('is the part of the page the keyboard covers', () => {
    expect(keyboardInset(844, { height: 520, offsetTop: 0 })).toBe(324);
    expect(keyboardInset(844, { height: 500, offsetTop: 20 })).toBe(324);
  });
  it('ignores browser chrome sliding and a page with no keyboard', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, { height: 900, offsetTop: 0 })).toBe(0);
  });
});

describe('useKeyboardInset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--kb-inset');
  });

  it('publishes --kb-inset while the keyboard is up and clears it on unmount', () => {
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    vi.stubGlobal('visualViewport', vv);
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    const { unmount } = renderHook(() => useKeyboardInset());
    const read = () => document.documentElement.style.getPropertyValue('--kb-inset');
    expect(read()).toBe('0px');
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    expect(read()).toBe('344px');
    unmount();
    expect(read()).toBe('');
  });

  it('does nothing where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(() => renderHook(() => useKeyboardInset())).not.toThrow();
  });
});

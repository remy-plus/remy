import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from './motion.ts';

const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce') }));

afterEach(() => vi.unstubAllGlobals());

describe('motion', () => {
  it('scrolls smoothly by default and jumps when the person asked for less motion', () => {
    reduced(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
    reduced(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });
});

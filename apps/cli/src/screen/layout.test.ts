import { describe, expect, it } from 'vitest';
import { computeLayout } from './layout.ts';

describe('computeLayout', () => {
  it('has no sidebar up to 120 columns and a 42 wide one above', () => {
    const a = computeLayout(120, 40);
    expect(a.sidebar).toBe('none');
    expect(a.contentWidth).toBe(116);
    const b = computeLayout(121, 40);
    expect(b.sidebar).toBe('inline');
    expect(b.contentWidth).toBe(121 - 4 - 42);
  });
  it('can switch the sidebar off', () => {
    expect(computeLayout(200, 40, { sidebar: false }).contentWidth).toBe(196);
  });
  it('grows the prompt to a third of the rows, six at least', () => {
    expect(computeLayout(100, 30).promptMaxRows).toBe(10);
    expect(computeLayout(100, 60).promptMaxRows).toBe(20);
    expect(computeLayout(100, 24).promptMaxRows).toBe(8);
    expect(computeLayout(100, 15).promptMaxRows).toBe(6);
  });
  it('keeps the prompt from taking the whole screen', () => {
    expect(computeLayout(100, 10).promptMaxRows).toBe(2);
    expect(computeLayout(100, 3).promptMaxRows).toBe(1);
  });
  it('limits the home prompt to 75 columns, or the screen less its gutters', () => {
    expect(computeLayout(200, 40).homePromptWidth).toBe(75);
    expect(computeLayout(60, 40).homePromptWidth).toBe(56);
  });
});

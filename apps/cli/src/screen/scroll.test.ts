import { describe, expect, it } from 'vitest';
import {
  halfDown,
  halfUp,
  hidden,
  pageDown,
  pageUp,
  SCROLL_START,
  scrollBy,
  settle,
  toBottom,
  topOf,
  toTop,
} from './scroll.ts';

describe('scroll', () => {
  it('follows the bottom while sticky and content grows', () => {
    expect(topOf(SCROLL_START, 100, 20)).toBe(80);
    expect(topOf(SCROLL_START, 130, 20)).toBe(110);
    expect(topOf(SCROLL_START, 5, 20)).toBe(0);
  });

  it('lets go of the bottom when the user scrolls up, and keeps its place as content grows', () => {
    const s = pageUp(SCROLL_START, 100, 20);
    expect(s).toEqual({ top: 70, sticky: false });
    expect(topOf(s, 140, 20)).toBe(70);
  });

  it('pages by half the height and half pages by a quarter', () => {
    expect(pageUp(SCROLL_START, 100, 20).top).toBe(70);
    expect(halfUp(SCROLL_START, 100, 20).top).toBe(75);
    const up = toTop(100, 20);
    expect(pageDown(up, 100, 20).top).toBe(10);
    expect(halfDown(up, 100, 20).top).toBe(5);
  });

  it('clamps at the top and never goes below the end', () => {
    expect(scrollBy({ top: 3, sticky: false }, -50, 100, 20).top).toBe(0);
    expect(scrollBy({ top: 79, sticky: false }, 50, 100, 20)).toEqual({ top: 80, sticky: true });
  });

  it('takes hold of the bottom again on reaching it', () => {
    let s = pageUp(SCROLL_START, 100, 20);
    expect(s.sticky).toBe(false);
    s = pageDown(s, 100, 20);
    expect(s.sticky).toBe(true);
  });

  it('home goes to the top; end sticks to the bottom', () => {
    expect(toTop(100, 20)).toEqual({ top: 0, sticky: false });
    expect(toBottom().sticky).toBe(true);
  });

  it('stays sticky when everything fits', () => {
    expect(toTop(5, 20).sticky).toBe(true);
    expect(pageUp(SCROLL_START, 5, 20)).toEqual({ top: 0, sticky: true });
  });

  it('settles a stored position after the window grows', () => {
    expect(settle({ top: 70, sticky: false }, 80, 20)).toEqual({ top: 60, sticky: true });
    expect(settle({ top: 10, sticky: false }, 80, 20)).toEqual({ top: 10, sticky: false });
  });

  it('counts the rows hidden above and below', () => {
    expect(hidden({ top: 30, sticky: false }, 100, 20)).toEqual({ above: 30, below: 50 });
    expect(hidden(SCROLL_START, 100, 20)).toEqual({ above: 80, below: 0 });
  });
});

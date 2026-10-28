// Scroll state of the viewport, as pure functions. `sticky` means "follow the bottom": while
// it holds, new content keeps the view at the end; scrolling up lets go, and scrolling back
// to the end takes hold again.

export interface Scroll {
  /** Index of the first visible row (meaningful when not sticky). */
  top: number;
  sticky: boolean;
}

export const SCROLL_START: Scroll = { top: 0, sticky: true };

/** The largest first-row index: the view that ends on the last row. */
export const maxTop = (total: number, height: number) => Math.max(0, total - height);

/** The first visible row now, given how much content there is. */
export function topOf(s: Scroll, total: number, height: number): number {
  const max = maxTop(total, height);
  return s.sticky ? max : Math.max(0, Math.min(s.top, max));
}

function at(top: number, total: number, height: number): Scroll {
  const max = maxTop(total, height);
  const t = Math.max(0, Math.min(top, max));
  return { top: t, sticky: t >= max };
}

/** Moves by `delta` rows from where the view is now. */
export const scrollBy = (s: Scroll, delta: number, total: number, height: number): Scroll =>
  at(topOf(s, total, height) + delta, total, height);

export const pageUp = (s: Scroll, total: number, height: number) =>
  scrollBy(s, -Math.max(1, Math.floor(height / 2)), total, height);
export const pageDown = (s: Scroll, total: number, height: number) =>
  scrollBy(s, Math.max(1, Math.floor(height / 2)), total, height);
export const halfUp = (s: Scroll, total: number, height: number) =>
  scrollBy(s, -Math.max(1, Math.floor(height / 4)), total, height);
export const halfDown = (s: Scroll, total: number, height: number) =>
  scrollBy(s, Math.max(1, Math.floor(height / 4)), total, height);
export const toTop = (total: number, height: number): Scroll => at(0, total, height);
export const toBottom = (): Scroll => ({ top: 0, sticky: true });

/** Keeps the stored position valid after the content or the window changed size. */
export const settle = (s: Scroll, total: number, height: number): Scroll =>
  s.sticky ? s : at(s.top, total, height);

/** Rows above and below the visible slice, for a "more" hint. */
export function hidden(s: Scroll, total: number, height: number) {
  const top = topOf(s, total, height);
  return { above: top, below: Math.max(0, total - height - top) };
}

// Keeps a bottom-pinned composer above the phone keyboard. iPhone Safari leaves the layout viewport
// as it was and shrinks only the visual one, so a `sticky; bottom: 0` box would sit under the keys.
// The gap between the two is published as `--kb-inset`; the composer adds it to its bottom offset.
import { useEffect } from 'react';

/** How much of the layout viewport the keyboard covers, in px (never negative). */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number },
): number {
  const gap = layoutHeight - visual.height - visual.offsetTop;
  // A few px of difference is browser chrome sliding away, not a keyboard.
  return gap > 80 ? Math.round(gap) : 0;
}

export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () =>
      root.style.setProperty('--kb-inset', `${keyboardInset(window.innerHeight, vv)}px`);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
    };
  }, []);
}

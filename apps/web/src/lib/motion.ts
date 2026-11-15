// Motion that script starts (CSS animations are switched off by the stylesheet's reduced-motion rule).

/** True when the person asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

/** `smooth` for a scroll that follows the chat, `auto` (a jump) for someone who asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

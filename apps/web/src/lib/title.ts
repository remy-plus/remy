// The browser tab and a screen reader's page announcement carry the name of the screen (WCAG 2.4.2).
// The name is the screen's own heading, so no list of titles has to be kept in step with the screens.
import { type RefObject, useEffect } from 'react';

const SUFFIX = 'Remy';

/** "Settings · Remy". A heading can carry `data-doc-title` when its own words make a poor title ("Good evening"). */
export function titleFrom(root: ParentNode): string {
  const h = root.querySelector('h1');
  const name = (h?.getAttribute('data-doc-title') ?? h?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? `${name} · ${SUFFIX}` : SUFFIX;
}

/** Keeps `document.title` on the first h1 inside `main`, including a heading that arrives after a load. */
export function useDocumentTitle(main: RefObject<HTMLElement | null>, path: string): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page starts a new look
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const apply = () => {
      document.title = titleFrom(el);
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [main, path]);
}

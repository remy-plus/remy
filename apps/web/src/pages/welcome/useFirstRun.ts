import { useEffect } from 'react';
import { matchRoute } from '../../router.ts';
import { isFirstVisit } from '../../settings.ts';

/** Sends a first visit from Home to the first-run steps. `?mock=1` is a demo link, so it stays put. */
export function useFirstRun(path: string) {
  useEffect(() => {
    if (matchRoute(path).name !== 'home') return;
    if (new URLSearchParams(window.location.search).get('mock') === '1') return;
    if (isFirstVisit()) window.location.hash = '#/welcome/1';
  }, [path]);
}

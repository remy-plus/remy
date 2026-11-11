import { useEffect } from 'react';
import { matchRoute } from '../../router.ts';

/** Whether this browser holds a session. Onboarding is reachable without one. */
export const hasToken = () => {
  try {
    return Boolean(window.localStorage.getItem('remy.token'));
  } catch {
    return false;
  }
};

/**
 * Without a token the app has nothing real to show, so every page but the sign-in ones goes to
 * sign-in. `?mock=1` is a demo link, so it stays put.
 */
export function useFirstRun(path: string) {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mock') === '1') return;
    const { name } = matchRoute(path);
    if (name === 'sign-in' || name === 'welcome' || name === 'quiet') return;
    if (!hasToken()) window.location.hash = '#/sign-in';
  }, [path]);
}

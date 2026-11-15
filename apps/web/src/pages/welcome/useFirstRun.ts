import { useEffect, useRef } from 'react';
import { useApi } from '../../api/index.tsx';
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

/**
 * A person who has a session but no model sees the setup screen, once per visit to the app: the
 * chat cannot answer without one, and "run remy login" is not something to ask of a first visit.
 * Only the front door is redirected; Settings and the rest stay reachable, and a server that cannot
 * be asked is left alone. "Skip setup" stays honest because the check is not repeated.
 */
export function useModelGate(path: string) {
  const api = useApi();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    if (api.kind !== 'http' || !api.modelSetup || !hasToken()) return;
    const { name } = matchRoute(path);
    if (name !== 'home') return;
    asked.current = true;
    let live = true;
    api.modelSetup().then(
      (d) => {
        if (live && !d.ready) window.location.hash = '#/welcome/1';
      },
      () => {}, // the chat says what is wrong when it is used
    );
    return () => {
      live = false;
    };
  }, [api, path]);
}

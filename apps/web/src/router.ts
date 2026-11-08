// A hash router: the page is static, so the route lives after the "#" and the server needs no rules.
import { useSyncExternalStore } from 'react';

export type RouteName =
  | 'home'
  | 'tasks'
  | 'task'
  | 'brain'
  | 'skills'
  | 'schedules'
  | 'connections'
  | 'settings'
  | 'settings-section'
  | 'not-found';

export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const TABLE: [pattern: string, name: RouteName][] = [
  ['/', 'home'],
  ['/tasks', 'tasks'],
  ['/tasks/:id', 'task'],
  ['/brain', 'brain'],
  ['/skills', 'skills'],
  ['/schedules', 'schedules'],
  ['/connections', 'connections'],
  ['/settings', 'settings'],
  ['/settings/:section', 'settings-section'],
];

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** "#/tasks/abc?x=1" becomes "/tasks/abc". */
export function pathOf(hash: string): string {
  const path = (hash.replace(/^#/, '').split('?')[0] ?? '').replace(/\/+$/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

export function matchRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, name] of TABLE) {
    const want = pattern.split('/').filter(Boolean);
    if (want.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = want.every((w, i) => {
      const got = parts[i] as string;
      if (w.startsWith(':')) {
        params[w.slice(1)] = decode(got);
        return true;
      }
      return w === got;
    });
    if (ok) return { name, params };
  }
  return { name: 'not-found', params: {} };
}

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};

/** The current path, kept in sync with the address bar. */
export const useHashPath = () =>
  useSyncExternalStore(
    subscribe,
    () => pathOf(window.location.hash),
    () => '/',
  );

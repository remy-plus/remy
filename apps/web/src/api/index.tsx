import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { createHttpApi } from './http.ts';
import { createMockApi } from './mock.ts';
import type { RemyApi } from './types.ts';

export const TOKEN_KEY = 'remy.token';

const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage can be blocked; sign-in then asks again
  }
};

/** Sends the person to sign in, and forgets a token the server did not accept. */
function signInAgain() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // blocked storage: there is nothing to forget
  }
  if (window.location.hash !== '#/sign-in') window.location.hash = '#/sign-in';
}

/** The mock runs only with `?mock=1` (a demo link). Everything else talks to the real server. */
export function chooseApi(search = window.location.search): RemyApi {
  const forced = new URLSearchParams(search).get('mock') === '1';
  return forced
    ? createMockApi()
    : createHttpApi({ token: readToken, onUnauthorized: signInAgain });
}

const ApiContext = createContext<RemyApi | null>(null);

export function ApiProvider({ api, children }: { api?: RemyApi; children: ReactNode }) {
  const value = useMemo(() => api ?? chooseApi(), [api]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): RemyApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi needs an ApiProvider above it.');
  return api;
}

export type * from './types.ts';

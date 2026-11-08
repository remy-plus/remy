import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { createHttpApi } from './http.ts';
import { createMockApi } from './mock.ts';
import type { RemyApi } from './types.ts';

export const TOKEN_KEY = 'remy.token';

const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage can be blocked; the mock then runs
  }
};

/** The mock runs with `?mock=1`, or when no token is stored yet. Otherwise the real server. */
export function chooseApi(search = window.location.search, token = readToken()): RemyApi {
  const forced = new URLSearchParams(search).get('mock') === '1';
  return forced || !token ? createMockApi() : createHttpApi({ token: readToken });
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

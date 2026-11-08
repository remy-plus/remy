import { useCallback, useEffect, useState } from 'react';
import { type HomeData, useApi } from './api/index.tsx';

export interface HomeState {
  data: HomeData | null;
  /** Set when the server could not be reached or refused. Plain words, safe to show. */
  error: string | null;
  reload: () => void;
}

/** Home data from the adapter. Reloads when asked, for example after an approval. */
export function useHome(): HomeState {
  const api = useApi();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    let live = true;
    api
      .home()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Remy could not be reached.');
      });
    return () => {
      live = false;
    };
  }, [api, n]);

  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { type StreamEvent, type TaskView, useApi } from '../../api/index.tsx';

const RECONNECT_MS = 3000;
const REFRESH_MS = 120;

const ended = (v: TaskView | null) =>
  v !== null && (v.status === 'succeeded' || v.status === 'failed' || v.status === 'cancelled');

/** Waits, but wakes at once when `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export interface TaskState {
  view: TaskView | null;
  events: StreamEvent[];
  error: string | null;
  reload: () => void;
}

/**
 * One task: its state, and its events as they arrive. The stream is followed while the task is open;
 * if it drops, it reconnects from the last event seen, so nothing is shown twice or missed.
 */
export function useTask(id: string): TaskState {
  const api = useApi();
  const [view, setView] = useState<TaskView | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const latest = useRef<TaskView | null>(null);
  latest.current = view;
  const reload = useCallback(() => setN((x) => x + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    let live = true;
    api
      .getTask(id)
      .then((v) => {
        if (!live) return;
        setView(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live)
          setError(
            e instanceof Error
              ? e.message
              : 'Remy could not be reached. Check that it is running, then reload.',
          );
      });
    return () => {
      live = false;
    };
  }, [api, id, n]);

  useEffect(() => {
    const ctl = new AbortController();
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setEvents([]);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setN((x) => x + 1), REFRESH_MS);
    };
    (async () => {
      while (!ctl.signal.aborted) {
        try {
          await api.streamTask(
            id,
            (e) => {
              if (e.seq <= last) return;
              last = e.seq;
              setEvents((prev) => [...prev, e]);
              refresh();
            },
            { lastEventId: last, signal: ctl.signal },
          );
        } catch {
          // A dropped connection is not an error to show: the next pass reconnects.
        }
        if (ctl.signal.aborted || ended(latest.current)) return;
        await pause(RECONNECT_MS, ctl.signal);
      }
    })();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [api, id]);

  return { view, events, error, reload };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { type LiveMessage, type StreamEvent, type TaskView, useApi } from '../../api/index.tsx';
import { describeError } from '../../lib/errors.ts';

const RECONNECT_MS = 3000;
const REFRESH_MS = 120;
/** Words arrive faster than anyone reads; the screen takes them about every frame. */
const LIVE_MS = 16;

/** What the model has written so far in its current reply (never stored; see `LiveMessage`). */
export interface LiveText {
  kind: 'text' | 'answer';
  text: string;
}

/** Folds one live message into the text so far. */
export function applyLive(prev: LiveText | null, m: LiveMessage): LiveText | null {
  if (m.kind === 'start') return null;
  if (m.kind === 'set') return { kind: m.of, text: m.text };
  if (prev && prev.kind === m.kind) return { kind: m.kind, text: prev.text + m.delta };
  return { kind: m.kind, text: m.delta };
}

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
  /** True while the event stream is connected: updates arrive by themselves, so nobody needs to poll. */
  streaming: boolean;
  /** The reply being written right now, if the server sends words as they come. */
  live: LiveText | null;
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
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<LiveText | null>(null);
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
        if (live) setError(describeError(e, 'Remy could not open this job. Try again.'));
      });
    return () => {
      live = false;
    };
  }, [api, id, n]);

  useEffect(() => {
    const ctl = new AbortController();
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    let written: LiveText | null = null;
    const showLive = () => {
      if (liveTimer) return;
      liveTimer = setTimeout(() => {
        liveTimer = undefined;
        setLive(written);
      }, LIVE_MS);
    };
    setEvents([]);
    setLive(null);
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
              // Narration before a tool call is over once the tool starts; an answer stays up
              // until the task's own answer replaces it.
              if (written?.kind === 'text' && /^(tool|approval)\./.test(e.event.type)) {
                written = null;
                showLive();
              }
              setEvents((prev) => [...prev, e]);
              refresh();
            },
            {
              lastEventId: last,
              signal: ctl.signal,
              onOpen: () => setStreaming(true),
              onLive: (m) => {
                written = applyLive(written, m);
                showLive();
              },
            },
          );
        } catch {
          // A dropped connection is not an error to show: the next pass reconnects.
        }
        if (!ctl.signal.aborted) setStreaming(false);
        if (ctl.signal.aborted || ended(latest.current)) return;
        await pause(RECONNECT_MS, ctl.signal);
      }
    })();
    return () => {
      ctl.abort();
      clearTimeout(timer);
      clearTimeout(liveTimer);
    };
  }, [api, id]);

  return { view, events, streaming, live, error, reload };
}

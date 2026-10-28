// Small motion helpers for the full-screen UI. Timers run only while something is animating,
// so an idle screen costs no CPU.
import { useEffect, useRef, useState } from 'react';

const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

/** Linear blend of two `#rrggbb` colours; `t` is clamped to 0..1. */
export function fadeColor(from: string, to: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * k);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

/** Frames in a fade: 150 ms reads as four steps at about 37 ms. */
export const FADE_STEPS = 4;

/**
 * Steps 0 to 1 over `ms` each time `key` changes (0.25, 0.5, 0.75, 1). It is 0 for the first render
 * of a new key and 1 once settled; with `ms` of 0 or less (or reduced motion) it is always 1.
 */
export function useFadeIn(key: string | number, ms = 150): number {
  const off = ms <= 0;
  const [state, setState] = useState({ key, step: off ? FADE_STEPS : 0 });
  const step = state.key === key ? state.step : 0;
  useEffect(() => {
    if (off) return;
    setState((s) => (s.key === key ? s : { key, step: 0 }));
    const t = setInterval(() => {
      setState((s) => {
        const next = Math.min(FADE_STEPS, (s.key === key ? s.step : 0) + 1);
        if (next >= FADE_STEPS) clearInterval(t);
        return { key, step: next };
      });
    }, ms / FADE_STEPS);
    return () => clearInterval(t);
  }, [key, ms, off]);
  return off ? 1 : step / FADE_STEPS;
}

/** Whole seconds since `startedAt` (epoch ms); ticks once a second, and not at all when undefined. */
export function useElapsed(startedAt: number | undefined, now: () => number = Date.now): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === undefined) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now() - startedAt) / 1000));
}

/** "12s", "1m 05s", "1h 02m". */
export function formatElapsed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** `value`, but a change shows at most once per `ms`; the first value shows at once. */
export function useThrottled<T>(value: T, ms = 250): T {
  const [shown, setShown] = useState(value);
  const last = useRef(Date.now());
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = ms - (Date.now() - last.current);
    const apply = () => {
      last.current = Date.now();
      setShown(value);
    };
    if (wait <= 0) return apply();
    const t = setTimeout(apply, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

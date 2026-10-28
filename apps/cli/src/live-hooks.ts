// Small hooks for things that tick: spinner frames and rate-limited text.
import { useEffect, useRef, useState } from 'react';
import { SPINNER_MS } from './theme.ts';

/** The next frame index, ticking while `active`. Always 0 when motion is reduced. */
export function useFrame(active: boolean, frames: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames), SPINNER_MS);
    return () => clearInterval(t);
  }, [active, frames]);
  return active ? frame : 0;
}

/** `value`, but a change shows at most once per `ms`; the first value shows at once. */
export function useSettled(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const last = useRef(Date.now());
  useEffect(() => {
    if (value === shown) return;
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

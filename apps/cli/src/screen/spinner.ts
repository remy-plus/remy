// Working indicators: a braille spinner and a short sweeping bar for the status row.
import { Text } from 'ink';
import { createElement as h, useEffect, useState } from 'react';
import { type ColorLevel, PALETTE, SYMBOLS } from '../theme.ts';
import { fadeColor } from './motion.ts';

export const SPIN_MS = 80;
export const SCAN_MS = 50;
export const SCAN_WIDTH = 8;
const STILL = '·';

/** The glyph for a tick; reduced motion always shows the still dot. */
export function spinnerGlyph(tick: number, reducedMotion = false): string {
  if (reducedMotion) return STILL;
  const f = SYMBOLS.spinner;
  return f[((tick % f.length) + f.length) % f.length] as string;
}

function useTick(active: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return active ? tick : 0;
}

/** The current spinner glyph. Ticks only while `active` and motion is allowed. */
export function useSpinner(active: boolean, opts: { reducedMotion?: boolean } = {}): string {
  const reducedMotion = opts.reducedMotion ?? false;
  const tick = useTick(active && !reducedMotion, SPIN_MS);
  return spinnerGlyph(tick, reducedMotion);
}

export function Spinner(p: {
  active: boolean;
  reducedMotion?: boolean;
  color?: string;
  dim?: boolean;
}) {
  const glyph = useSpinner(p.active, { reducedMotion: p.reducedMotion });
  return h(Text, { color: p.color, dimColor: p.dim }, glyph);
}

export interface ScanSpan {
  text: string;
  color?: string;
  dim?: boolean;
}

const BLOCKS = ['▁', '▂', '▃', '▅', '▆'];

/**
 * One frame of the scanner: a bright head bouncing across `width` cells with a soft tail.
 * Truecolor blends stone to signal; basic and none draw a plain dim dot run (head as a bullet).
 */
export function scannerFrame(tick: number, width: number, level: ColorLevel): ScanSpan[] {
  const w = Math.max(1, Math.floor(width));
  const period = Math.max(1, 2 * (w - 1));
  const m = ((Math.floor(tick) % period) + period) % period;
  const head = m < w ? m : period - m;
  const spans: ScanSpan[] = [];
  for (let i = 0; i < w; i++) {
    const near = Math.max(0, 1 - Math.abs(i - head) / 3);
    if (level === 'truecolor') {
      const glyph = BLOCKS[Math.round(near * (BLOCKS.length - 1))] as string;
      spans.push({ text: glyph, color: fadeColor(PALETTE.stone, PALETTE.signal, near) });
    } else {
      spans.push({ text: i === head ? '•' : '·', dim: i !== head });
    }
  }
  return spans;
}

/** Scanner tick; stays at 0 (a still bar) when inactive or reduced. */
export function useScanner(active: boolean, reducedMotion = false): number {
  return useTick(active && !reducedMotion, SCAN_MS);
}

export function Scanner(p: {
  active: boolean;
  level: ColorLevel;
  width?: number;
  reducedMotion?: boolean;
}) {
  const tick = useScanner(p.active, p.reducedMotion);
  const spans = scannerFrame(tick, p.width ?? SCAN_WIDTH, p.level);
  return h(
    Text,
    null,
    ...spans.map((s, i) => h(Text, { key: i, color: s.color, dimColor: s.dim }, s.text)),
  );
}

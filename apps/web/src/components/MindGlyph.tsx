import { useEffect, useRef, useState } from 'react';
import { supported } from '../lib/ascii.ts';
import {
  blendParams,
  ease,
  type MindParams,
  type MindState,
  mindCell,
  mindCellWith,
  mindLabel,
  mindParams,
} from '../lib/mind.ts';

const PAPER = '#edebe6';
const ACCENT = '#a8c49a';
const FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const FRAME_MS = 1000 / 30;
const BLEND_S = 0.4;

/** A fixed ASCII sphere for one state, used when the canvas cannot or should not animate. */
function staticCluster(state: MindState): string {
  const cols = 23;
  const rows = 12;
  // `done` shows its settled look, `waiting` shows the cursor lit.
  const t = state === 'done' ? 5 : state === 'waiting' ? 0 : 1.3;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) line += mindCell(state, t, c, r, cols, rows, 0.5).ch;
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/**
 * Remy's living mind: a shaded ASCII sphere that shows what Remy is doing. Paper glyphs; the accent is
 * used only for the waiting cursor and the done wave. States blend over about 400 ms. Capped at 30 fps,
 * paused off screen and in hidden tabs, and a static `<pre>` when motion is off or unsupported.
 */
export function MindGlyph({
  state,
  level = 0,
  size = 120,
  className = '',
}: {
  state: MindState;
  level?: number;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(supported);
  const now0 = performance.now() / 1000;
  const current = useRef({
    state,
    level,
    since: now0,
    // The parameters at the moment of the last change, blended toward the new state.
    from: mindParams(state, 0, level) as MindParams,
    changed: now0 - BLEND_S,
    last: mindParams(state, 0, level) as MindParams,
    phase: 0,
    lastT: now0,
  });
  current.current.level = level;

  useEffect(() => {
    const s = current.current;
    if (s.state === state) return;
    const now = performance.now() / 1000;
    s.from = { ...s.last };
    s.changed = now;
    s.state = state;
    s.since = now;
  }, [state]);

  useEffect(() => {
    const canvas = ref.current;
    if (!live || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setLive(false);
      return;
    }
    const cols = Math.max(15, Math.min(35, Math.round(size / 6.5))) | 1;
    const cw = size / cols;
    const fs = cw / 0.6;
    const rh = fs * 1.1;
    const rows = Math.max(1, Math.floor(size / rh)) | 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    const yOff = (size - rows * rh) / 2;
    // Cell positions, computed once.
    const xs = Array.from({ length: cols }, (_, c) => c * cw);
    const ys = Array.from({ length: rows }, (_, r) => yOff + (r + 0.8) * rh);

    const draw = (ms: number) => {
      const s = current.current;
      const now = ms / 1000;
      const t = now - s.since;
      const k = ease((now - s.changed) / BLEND_S);
      const target = mindParams(s.state, t, s.level);
      const p = k >= 1 ? target : blendParams(s.from, target, k);
      // The texture turns by the blended speed, so a state change never jumps it.
      s.phase += p.spin * Math.min(0.1, Math.max(0, now - s.lastT));
      s.lastT = now;
      p.phase = s.phase;
      s.last = p;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = PAPER;
      let alpha = -1;
      let accent = false;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const cell = mindCellWith(p, now, c, r, cols, rows);
          if (cell.ch === ' ') continue;
          const a = cell.accent ? 1 : Math.round((0.22 + 0.78 * cell.light) * 40) / 40;
          if (a !== alpha) {
            ctx.globalAlpha = a;
            alpha = a;
          }
          if (cell.accent !== accent) {
            ctx.fillStyle = cell.accent ? ACCENT : PAPER;
            accent = cell.accent;
          }
          ctx.fillText(cell.ch, xs[c] ?? 0, ys[r] ?? 0);
        }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let lastDraw = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - lastDraw < FRAME_MS - 1) return;
      lastDraw = ms;
      draw(ms);
    };
    let visible = true;
    const run = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      current.current.lastT = performance.now() / 1000;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? false;
      if (visible) run();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : run());
    document.addEventListener('visibilitychange', onVis);
    run();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [live, size]);

  return (
    <span
      role="img"
      aria-label={mindLabel(state)}
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      {live ? (
        <canvas ref={ref} style={{ width: size, height: size }} />
      ) : (
        <pre
          aria-hidden="true"
          className="m-0 flex h-full w-full items-center justify-center font-mono font-bold leading-[1.1] text-[#edebe6]"
          style={{ fontSize: size / 24 }}
        >
          {staticCluster(state)}
        </pre>
      )}
    </span>
  );
}

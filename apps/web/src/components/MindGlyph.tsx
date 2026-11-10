import { useEffect, useRef, useState } from 'react';
import { supported } from '../lib/ascii.ts';
import { type MindState, mindCell, mindLabel } from '../lib/mind.ts';

const PAPER = '#edebe6';
const ACCENT = '#a8c49a';
const COLS = 15;
const FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';

/** A fixed ASCII cluster for one state, used when the canvas cannot or should not animate. */
function staticCluster(state: MindState): string {
  const cols = 13;
  const rows = 7;
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
 * Remy's small living mind: a round ASCII cluster that shows what Remy is doing. Paper glyphs; the accent
 * is used only for the waiting cursor and the done flash. A static `<pre>` when motion is off or unsupported.
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
  const current = useRef({ state, level, since: performance.now() / 1000 });
  current.current.level = level;

  // The state clock restarts on every change.
  useEffect(() => {
    current.current.state = state;
    current.current.since = performance.now() / 1000;
  }, [state]);

  useEffect(() => {
    const canvas = ref.current;
    if (!live || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setLive(false);
      return;
    }
    const cw = size / COLS;
    const fs = cw / 0.6;
    const rh = fs * 1.1;
    const rows = Math.max(1, Math.floor(size / rh));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    const yOff = (size - rows * rh) / 2;

    const draw = (now: number) => {
      const s = current.current;
      const t = now / 1000 - s.since;
      ctx.clearRect(0, 0, size, size);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < COLS; c++) {
          const cell = mindCell(s.state, t, c, r, COLS, rows, s.level);
          if (cell.ch === ' ') continue;
          ctx.fillStyle = cell.accent ? ACCENT : PAPER;
          ctx.globalAlpha = cell.accent ? 1 : 0.25 + 0.75 * cell.light;
          ctx.fillText(cell.ch, c * cw, yOff + (r + 0.8) * rh);
        }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let visible = true;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      draw(ms);
    };
    const run = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
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
          style={{ fontSize: size / 13 }}
        >
          {staticCluster(state)}
        </pre>
      )}
    </span>
  );
}

// The orb: a shaded sphere drawn with 0 and 1, a tilted ring, and one labelled satellite per item.
// Decorative (aria-hidden); one still frame under reduced motion; paused while the tab is hidden.
import { useEffect, useRef } from 'react';

export interface Satellite {
  label: string;
}

const [W, H, CW, CH, R] = [560, 268, 6.8, 11.6, 112]; // canvas, cell and sphere sizes in px
const [CX, CY] = [W / 2, H / 2];
const [TILT, RING_A, RING_B, RING_POINTS, FRAME_MS] = [-0.3, 214, 54, 44, 80];
const LIGHT = [-0.5, -0.55, 0.67] as const; // from the top left, already near unit length
const MONO = 'ui-monospace, monospace';
const BODY = `11.3px "JetBrains Mono", ${MONO}`;

const hash = (x: number, y: number, k: number) => {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 1;
};

/** A point on the ring at angle `a`, and whether it is on the near side of the sphere. */
const onRing = (a: number) => {
  const u = RING_A * Math.cos(a);
  const v = RING_B * Math.sin(a);
  return {
    x: CX + u * Math.cos(TILT) - v * Math.sin(TILT),
    y: CY + u * Math.sin(TILT) + v * Math.cos(TILT),
    front: Math.sin(a) > 0,
  };
};
const hidden = (p: { x: number; y: number; front: boolean }) =>
  !p.front && Math.hypot(p.x - CX, p.y - CY) < R;

const color = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function drawOrb(ctx: CanvasRenderingContext2D, t: number, labels: string[]) {
  const ink = color('--text', '#edebe6');
  const signal = color('--signal', '#a8c49a');
  const dim = color('--muted', '#8c8a85');
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = BODY;
  const put = (ch: string, x: number, y: number, alpha: number, fill: string) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillText(ch, x, y);
  };
  // The ring, behind first (dots), then the sphere, then the near side (o).
  const ring = (front: boolean) => {
    for (let i = 0; i < RING_POINTS; i++) {
      const p = onRing((i / RING_POINTS) * Math.PI * 2);
      if (p.front !== front || hidden(p)) continue;
      put(front ? 'o' : '.', p.x, p.y, front ? 0.7 : 0.35, ink);
    }
  };
  ring(false);

  const slow = Math.floor(t * 0.8);
  for (let iy = 0; iy < Math.floor(H / CH); iy++) {
    for (let ix = 0; ix < Math.floor(W / CW); ix++) {
      const x = (ix + 0.5) * CW;
      const y = (iy + 0.5) * CH;
      const nx = (x - CX) / R;
      const ny = (y - CY) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 >= 1) continue;
      const nz = Math.sqrt(1 - r2);
      const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const texture = 0.5 + 0.5 * Math.sin(nx * 7 + t * 0.25) * Math.cos(ny * 6 - t * 0.2);
      const b = 0.3 + 0.5 * lambert + 0.14 * texture * (0.4 + lambert) + 0.35 * (1 - nz) ** 3;
      const glyph = b > 0.95 ? '@' : hash(ix, iy, slow) ? '1' : '0';
      put(glyph, x, y, Math.min(1, 0.2 + 0.8 * b), ink);
    }
  }
  ring(true);

  labels.forEach((label, i) => {
    const a = t * 0.25 + (i * Math.PI * 2) / labels.length + 1;
    const head = onRing(a);
    if (hidden(head)) return;
    for (let k = 1; k <= 4; k++) {
      const tail = onRing(a - k * 0.06);
      if (!hidden(tail)) put('.', tail.x, tail.y, 0.5 - k * 0.1, signal);
    }
    put('@', head.x, head.y, 1, signal);
    const right = head.x > CX;
    ctx.font = `10px "JetBrains Mono", ${MONO}`;
    ctx.textAlign = right ? 'left' : 'right';
    put(label, head.x + (right ? 10 : -10), head.y - 6, 1, dim);
    ctx.textAlign = 'center';
    ctx.font = BODY;
  });
  ctx.globalAlpha = 1;
}

export function Orb({ satellites = [] }: { satellites?: Satellite[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = satellites.map((s) => s.label).join('\n');
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const labels = key ? key.split('\n') : [];
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (still) {
      drawOrb(ctx, 0, labels);
      return;
    }
    const start = performance.now();
    let last = Number.NEGATIVE_INFINITY;
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        drawOrb(ctx, (now - start) / 1000, labels);
      }
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
    };
  }, [key]);

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas is not focusable; it is decoration
    <canvas
      ref={ref}
      aria-hidden="true"
      className="block h-auto w-full"
      style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}
    />
  );
}

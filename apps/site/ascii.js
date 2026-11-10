// Live ASCII for remy.plus. Two small canvas pieces, no libraries:
//   createAsciiMark: the brand wordmark, drawn from its own characters. It decodes in from
//     scrambled glyphs row by row, shimmers while it sits, and heats up under the pointer.
//     At rest it is the exact ASCII from branding/logo/remy-wordmark.txt.
//   createDotField: a quiet halftone field of dots that flows, and swells around the pointer.
// Both pause when off screen or when the tab is hidden, and do nothing under reduced motion
// (the page keeps its static SVG wordmark then).
const RAMP = '.:;+=*%#@$8MW&';
const ROW_COLORS = ['#94928d', '#a09e99', '#b0aea8', '#c0bdb8', '#d6d4ce', '#edebe6'];

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Runs `draw(now, dt)` every frame while `target` is on screen and the tab is visible. */
function loop(target, draw, fps = 60) {
  let raf = 0;
  let last = 0;
  let visible = true;
  const min = 1000 / fps - 3;
  const tick = (ms) => {
    raf = requestAnimationFrame(tick);
    if (ms - last < min) return;
    const dt = Math.min(0.05, (ms - last) / 1000 || 0.016);
    last = ms;
    draw(ms / 1000, dt);
  };
  const run = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) run();
    else stop();
  });
  io.observe(target);
  const vis = () => (document.hidden ? stop() : run());
  document.addEventListener('visibilitychange', vis);
  run();
  return () => {
    stop();
    io.disconnect();
    document.removeEventListener('visibilitychange', vis);
  };
}

/** Tracks the pointer in a canvas's own coordinates (also touch). `null` when away. */
function pointer(canvas) {
  const p = { x: -1e4, y: -1e4, on: false };
  const move = (e) => {
    const r = canvas.getBoundingClientRect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    p.on = true;
  };
  const leave = () => {
    p.on = false;
    p.x = p.y = -1e4;
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  p.destroy = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerleave', leave);
    window.removeEventListener('blur', leave);
  };
  return p;
}

export function createAsciiMark(canvas, lines, opts = {}) {
  const rows = lines.length;
  const cols = Math.max(...lines.map((l) => l.length));
  const ctx = canvas.getContext('2d');
  const colors = ROW_COLORS.map(rgb);
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ch = lines[r][c] ?? ' ';
      if (ch === ' ') continue;
      const id = r * 97 + c;
      cells.push({ r, c, ch, id, t0: r * 0.2 + (c / cols) * 0.6 + hash(id) * 0.3 + 0.25, heat: 0 });
    }
  let fs = 16;
  let cw = 10;
  let rh = 18;
  const fontFamily = opts.fontFamily ?? '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const resize = () => {
    const w = canvas.clientWidth || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = w / cols;
    fs = cw / 0.6;
    rh = fs * 1.1;
    const h = rows * rh;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `700 ${fs}px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const ptr = opts.interactive === false ? null : pointer(canvas);
  let started = performance.now() / 1000;
  // The decode plays when the wordmark first scrolls into view.
  const first = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    started = performance.now() / 1000;
    first.disconnect();
  });
  first.observe(canvas);

  const draw = (now, dt) => {
    const t = now - started;
    ctx.clearRect(0, 0, canvas.clientWidth, rows * rh);
    const reach = cw * 4.5;
    for (const k of cells) {
      const x = k.c * cw;
      const y = (k.r + 0.8) * rh;
      const base = colors[Math.min(k.r, colors.length - 1)];
      let ch = k.ch;
      let light = 0;
      let alpha = 1;
      if (t < k.t0 - 0.6) continue;
      if (t < k.t0) {
        // Decoding: a different glyph every few frames, dim.
        ch = RAMP[Math.floor(hash(k.id + Math.floor(t * 16)) * RAMP.length)];
        alpha = 0.35 + 0.35 * clamp((t - (k.t0 - 0.6)) / 0.6);
      } else {
        light = Math.max(0, 1 - (t - k.t0) / 0.5) * 0.9; // a flash as each glyph lands
        // A slow band of light drifts across the wordmark.
        const s = 0.5 + 0.5 * Math.cos(((k.c / cols) * 1.1 - k.r * 0.06) * Math.PI * 2 - t * 0.7);
        light += s ** 8 * 0.4;
        // A rare twinkle.
        if (hash(k.id * 3 + Math.floor(t * 2.5)) > 0.992) light += 0.45;
      }
      if (ptr?.on) {
        const d = Math.hypot(x + cw / 2 - ptr.x, y - rh * 0.4 - ptr.y);
        if (d < reach) k.heat = Math.max(k.heat, 1 - d / reach);
      }
      if (k.heat > 0.02) {
        if (k.heat > 0.12) ch = RAMP[Math.min(RAMP.length - 1, Math.floor(k.heat * RAMP.length))];
        light = Math.max(light, k.heat);
        k.heat = Math.max(0, k.heat - dt * 1.3);
      }
      const l = clamp(light);
      const R = Math.round(base[0] + (255 - base[0]) * l);
      const G = Math.round(base[1] + (255 - base[1]) * l);
      const B = Math.round(base[2] + (255 - base[2]) * l);
      ctx.fillStyle = `rgba(${R},${G},${B},${alpha})`;
      ctx.fillText(ch, x, y);
    }
  };
  const stop = loop(canvas, draw, opts.fps ?? 60);
  return {
    replay() {
      started = performance.now() / 1000;
    },
    destroy() {
      stop();
      first.disconnect();
      ro.disconnect();
      ptr?.destroy();
    },
  };
}

export function createDotField(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const cell = opts.cell ?? 18;
  const color = opts.color ?? '140,138,133';
  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || 800;
    h = canvas.clientHeight || 500;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const ptr = pointer(canvas);
  const swell = { v: 0 };
  const draw = (now, dt) => {
    ctx.clearRect(0, 0, w, h);
    swell.v += ((ptr.on ? 1 : 0) - swell.v) * Math.min(1, dt * 4);
    const nx = Math.ceil(w / cell);
    const ny = Math.ceil(h / cell);
    ctx.fillStyle = `rgba(${color},0.6)`;
    ctx.beginPath();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i * cell + cell / 2;
        const y = j * cell + cell / 2;
        let v =
          0.5 +
          0.28 * Math.sin(i * 0.16 + now * 0.55) +
          0.22 * Math.sin(j * 0.21 - now * 0.42 + i * 0.05) +
          0.12 * Math.sin((i + j) * 0.09 + now * 0.3);
        if (ptr.on) v += Math.max(0, 1 - Math.hypot(x - ptr.x, y - ptr.y) / 170) * 0.7 * swell.v;
        const r = cell * 0.5 * clamp((v - 0.42) * 1.6);
        if (r < 0.7) continue;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  };
  const stop = loop(canvas, draw, opts.fps ?? 30);
  return {
    destroy() {
      stop();
      ro.disconnect();
      ptr.destroy();
    },
  };
}

/** Counts a number up with a small ease. `el` keeps its text if motion is off. */
export function countUp(el, to, { ms = 1400, format = (n) => String(n) } = {}) {
  const t0 = performance.now();
  const step = (t) => {
    const p = clamp((t - t0) / ms);
    el.textContent = format(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

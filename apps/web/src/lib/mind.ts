// The Mind: pure, deterministic cells for Remy's living ASCII sphere. `mindCell` says what one cell of a
// round, lit sphere shows at time `t` (seconds since the state began). No drawing happens here.
// Every state is a set of numeric parameters (`MindParams`), so the component can blend between states
// instead of jumping. Brightness is glyph density only; the accent is the waiting cursor and the done wave.
export type MindState = 'rest' | 'listening' | 'thinking' | 'working' | 'waiting' | 'done';

export interface MindCell {
  ch: string;
  /** Brightness 0..1; also the glyph density. */
  light: number;
  /** True only for the blinking cursor (waiting) and the wave front (done). */
  accent: boolean;
}

export const RAMP = '.:;+=*%#@$8MW&';

export const MIND_STATES: readonly MindState[] = [
  'rest',
  'listening',
  'thinking',
  'working',
  'waiting',
  'done',
];

const LABELS: Record<MindState, string> = {
  rest: 'Remy is resting',
  listening: 'Remy is listening',
  thinking: 'Remy is thinking',
  working: 'Remy is working',
  waiting: 'Remy is waiting for you',
  done: 'Remy is done',
};

export const mindLabel = (state: MindState): string => LABELS[state];

/** Everything that makes one state look like itself. All numbers, so two sets can be blended. */
export interface MindParams {
  /** Texture rotation speed (radians per second) and the rotation so far. */
  spin: number;
  phase: number;
  /** Sphere radius (0..1 of the cell grid) and how much it breathes. */
  radius: number;
  breathe: number;
  /** Glyphs pulled inward and scrambled (thinking). */
  collapse: number;
  /** Bright core strength. */
  core: number;
  /** Orbiting ring of denser glyphs. */
  ring: number;
  /** Outward rings, already scaled by level. */
  ripple: number;
  /** Outward wave from the centre (done): strength and the radius of its front. */
  wave: number;
  waveR: number;
  /** 1 = the centre cell is a blinking accent cursor. */
  cursor: number;
  /** Chance scale for sparkles. */
  sparkle: number;
  /** Overall brightness multiplier. */
  dim: number;
}

const BASE: MindParams = {
  spin: 0.35,
  phase: 0,
  radius: 0.94,
  breathe: 0.03,
  collapse: 0,
  core: 0,
  ring: 0,
  ripple: 0,
  wave: 0,
  waveR: -1,
  cursor: 0,
  sparkle: 1,
  dim: 1,
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** The parameters of a state `ts` seconds after it began, with microphone `level` 0..1. */
export function mindParams(state: MindState, ts = 0, level = 0): MindParams {
  const lv = clamp(level);
  let p: MindParams;
  switch (state) {
    case 'rest':
      p = { ...BASE };
      break;
    case 'listening':
      p = {
        ...BASE,
        spin: 0.5,
        breathe: 0,
        radius: 0.88 + 0.08 * lv,
        ripple: 0.3 + 0.9 * lv,
        sparkle: 0.5,
        dim: 0.95,
      };
      break;
    case 'thinking':
      p = { ...BASE, spin: 2.4, radius: 0.86, collapse: 1, core: 1, sparkle: 0.3 };
      break;
    case 'working':
      p = { ...BASE, spin: 0.6, radius: 0.72, breathe: 0.015, ring: 1, sparkle: 0.5 };
      break;
    case 'waiting':
      p = { ...BASE, spin: 0.06, radius: 0.9, breathe: 0.01, cursor: 1, sparkle: 0, dim: 0.72 };
      break;
    case 'done':
      p = { ...BASE, spin: 0.5, wave: 1, waveR: ts * 1.7 };
      break;
  }
  p.phase = p.spin * ts;
  return p;
}

/** Linear blend of two parameter sets: `k` 0 is `a`, 1 is `b`. */
export function blendParams(a: MindParams, b: MindParams, k: number): MindParams {
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof MindParams)[])
    out[key] = a[key] + (b[key] - a[key]) * k;
  // The wave front is a position, not an amount: keep the live one while it fades in or out.
  out.waveR = b.wave > 0 ? b.waveR : a.waveR;
  return out;
}

/** Ease for a 0..1 transition progress. */
export const ease = (k: number) => {
  const x = clamp(k);
  return x * x * (3 - 2 * x);
};

const EMPTY: MindCell = { ch: ' ', light: 0, accent: false };
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const glyph = (d: number) =>
  RAMP[Math.min(RAMP.length - 1, Math.floor(clamp(d) * RAMP.length))] ?? '.';

/** Per-cell constants for one grid size, computed once. */
interface Grid {
  nx: Float32Array;
  ny: Float32Array;
  r: Float32Array;
  ring: Float32Array; // ellipse distance of the orbit ring (1 = on it)
  ringAngle: Float32Array;
  ringFront: Uint8Array;
}
const grids = new Map<string, Grid>();
const TILT = -0.35;
const RING_A = 0.95;
const RING_B = 0.34;
function gridFor(cols: number, rows: number): Grid {
  const key = `${cols}x${rows}`;
  const hit = grids.get(key);
  if (hit) return hit;
  const n = cols * rows;
  const g: Grid = {
    nx: new Float32Array(n),
    ny: new Float32Array(n),
    r: new Float32Array(n),
    ring: new Float32Array(n),
    ringAngle: new Float32Array(n),
    ringFront: new Uint8Array(n),
  };
  const [ct, st] = [Math.cos(TILT), Math.sin(TILT)];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const nx = ((col + 0.5) / cols) * 2 - 1;
      const ny = ((row + 0.5) / rows) * 2 - 1;
      const u = (nx * ct + ny * st) / RING_A;
      const v = (-nx * st + ny * ct) / RING_B;
      g.nx[i] = nx;
      g.ny[i] = ny;
      g.r[i] = Math.hypot(nx, ny);
      g.ring[i] = Math.hypot(u, v);
      g.ringAngle[i] = Math.atan2(v, u);
      g.ringFront[i] = v > 0 ? 1 : 0;
    }
  grids.set(key, g);
  return g;
}

// Light from the top left, already near unit length.
const LX = -0.5;
const LY = -0.55;
const LZ = 0.67;

/** One cell of the Mind for an explicit parameter set (the component blends these between states). */
export function mindCellWith(
  p: MindParams,
  t: number,
  col: number,
  row: number,
  cols: number,
  rows: number,
): MindCell {
  const g = gridFor(cols, rows);
  const i = row * cols + col;
  const r = g.r[i] ?? 2;
  if (r > 1) return EMPTY;
  const id = row * 97 + col;
  const nx = g.nx[i] ?? 0;
  const ny = g.ny[i] ?? 0;

  // The cursor: the centre cell blinks as the only accent glyph while the sphere holds still.
  if (p.cursor >= 0.5 && col === Math.floor(cols / 2) && row === Math.floor(rows / 2))
    return Math.floor(t * 1.6) % 2 === 0 ? { ch: '@', light: 1, accent: true } : EMPTY;

  const R = Math.min(1, p.radius * (1 + p.breathe * Math.sin(t * 0.9)));
  let b = 0;
  let accent = false;
  let onSphere = false;

  const q = (r * r) / (R * R);
  if (q <= 1) {
    onSphere = true;
    const sx = nx / R;
    const sy = ny / R;
    const nz = Math.sqrt(1 - q);
    const lambert = Math.max(0, sx * LX + sy * LY + nz * LZ);
    // A texture field fixed to the sphere, turned about the vertical axis so the glyphs shimmer.
    const c = Math.cos(p.phase);
    const s = Math.sin(p.phase);
    const tx = sx * c + nz * s;
    const tz = -sx * s + nz * c;
    const grain = 0.5 + 0.5 * Math.sin(tx * 5.5 + sy * 2.5) * Math.cos(tz * 4.5 - sy * 3);
    const swirl = 0.5 + 0.5 * Math.sin(Math.sqrt(q) * 10 + p.phase * 3);
    const tex = grain * (1 - 0.6 * p.collapse) + swirl * 0.6 * p.collapse;
    b = 0.08 + 0.5 * lambert + 0.3 * tex * (0.3 + lambert) + 0.16 * (1 - nz) ** 3;
    b += 0.06 * hash(id + Math.floor(t * 3) * 17);
    // The core forms while thinking.
    if (p.core > 0) b += p.core * Math.exp(-q * 7) * (0.5 + 0.2 * Math.sin(t * 7));
    if (p.collapse > 0) b *= 1 - p.collapse * 0.4 * hash(id + Math.floor(t * 12) * 31) * (0.4 + r);
    // Sparkles: a glyph briefly jumps up the ramp.
    if (hash(id * 3.1 + Math.floor(t * 4) * 13.7) > 1 - 0.022 * p.sparkle) b += 0.45;
  }
  // Outward rings (listening).
  if (p.ripple > 0) {
    const ring = Math.max(0, Math.sin(r * 9 - t * 4.2)) ** 3;
    b += p.ripple * ring * (1 - r * 0.5) * (onSphere ? 0.55 : 0.7);
  }
  // The orbiting ring of denser glyphs (working); its far half hides behind the sphere.
  if (p.ring > 0) {
    const e = Math.abs((g.ring[i] ?? 9) - 1);
    const front = g.ringFront[i] === 1;
    if (e < 0.25 && (front || !onSphere)) {
      const head = 0.5 + 0.5 * Math.cos((g.ringAngle[i] ?? 0) - t * 1.6);
      b = Math.max(b, p.ring * (0.4 + 0.6 * head * head) * (front ? 1 : 0.7) * (1 - e * 1.5));
    }
  }
  // One bright wave from the centre (done).
  if (p.wave > 0) {
    const d = (r - p.waveR) / 0.12;
    const w = p.wave * Math.exp(-d * d);
    b += w * 0.75;
    accent = w > 0.75;
  }
  const light = clamp(b * p.dim);
  if (light < 0.04) return EMPTY;
  return { ch: glyph(light), light, accent };
}

export function mindCell(
  state: MindState,
  t: number,
  col: number,
  row: number,
  cols: number,
  rows: number,
  level = 0,
): MindCell {
  return mindCellWith(mindParams(state, t, level), t, col, row, cols, rows);
}

// The Mind: pure, deterministic cells for Remy's small living ASCII cluster. `mindCell` says what one
// cell of a round cluster shows at time `t` (seconds since the state began). No drawing happens here.
export type MindState = 'rest' | 'listening' | 'thinking' | 'working' | 'waiting' | 'done';

export interface MindCell {
  ch: string;
  /** Brightness 0..1; also the glyph density. */
  light: number;
  /** True only for the blinking cursor (waiting) and the flash (done). */
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

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const glyph = (d: number) =>
  RAMP[Math.min(RAMP.length - 1, Math.floor(clamp(d) * RAMP.length))] ?? '.';
const EMPTY: MindCell = { ch: ' ', light: 0, accent: false };
const plain = (d: number): MindCell => {
  const light = clamp(d);
  return light < 0.04 ? EMPTY : { ch: glyph(light), light, accent: false };
};

/** The sparse, breathing look of `rest`; `done` settles into it. */
function restCell(t: number, id: number, r: number): number {
  if (hash(id) < 0.45 + r * 0.3) return 0;
  const breath = 0.5 + 0.5 * Math.sin(t * 0.8 + r * 1.5);
  return (1 - r) * (0.2 + 0.25 * breath) + 0.06;
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
  const nx = ((col + 0.5) / cols) * 2 - 1;
  const ny = ((row + 0.5) / rows) * 2 - 1;
  const r = Math.hypot(nx, ny);
  if (r > 1) return EMPTY;
  const id = row * 97 + col;
  switch (state) {
    case 'rest':
      return plain(restCell(t, id, r));
    case 'listening': {
      const lv = clamp(level);
      const wave = 0.5 + 0.5 * Math.sin(r * 6 - t * 4);
      return plain(0.06 + lv * (1 - r * 0.6) * (0.45 + 0.55 * wave) + (1 - r) * 0.08);
    }
    case 'thinking': {
      const pulse = 0.5 + 0.5 * Math.sin(r * 8 + t * 9);
      const d = (1 - r) * 0.35 + 0.55 * pulse * (1 - r * 0.5);
      const scrambled = hash(id + Math.floor(t * 14 + r * 3) * 31);
      const light = clamp(d);
      const idx = Math.min(
        RAMP.length - 1,
        Math.floor(scrambled * (2 + light * (RAMP.length - 2))),
      );
      return { ch: RAMP[idx] ?? '.', light, accent: false };
    }
    case 'working': {
      if (r < 0.3) return plain(0.85);
      if (Math.abs(r - 0.7) > 0.2) return EMPTY;
      const head = 0.5 + 0.5 * Math.cos(Math.atan2(ny, nx) - t * 1.6);
      return plain(0.25 + 0.75 * head ** 2);
    }
    case 'waiting': {
      if (col === Math.floor(cols / 2) && row === Math.floor(rows / 2))
        return Math.floor(t * 1.6) % 2 === 0 ? { ch: '@', light: 1, accent: true } : EMPTY;
      return hash(id) < 0.7 ? EMPTY : plain((1 - r) * 0.22 + 0.05);
    }
    case 'done': {
      const flash = Math.exp(-Math.max(0, t) * 4);
      const base = restCell(t, id, r);
      const d = clamp(flash * (1 - r * 0.5) + base * (1 - flash));
      const cell = plain(d);
      return cell === EMPTY ? cell : { ...cell, accent: flash > 0.5 };
    }
  }
}

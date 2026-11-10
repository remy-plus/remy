import { describe, expect, it } from 'vitest';
import {
  blendParams,
  MIND_STATES,
  type MindState,
  mindCell,
  mindCellWith,
  mindLabel,
  mindParams,
  RAMP,
} from './mind.ts';

const N = 21;
const grid = (s: MindState, t = 0.3, level = 0.7) =>
  Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => mindCell(s, t, c, r, N, N, level).ch).join(''),
  ).join('\n');
const count = (s: string) => s.replace(/[ \n]/g, '').length;

describe('mind', () => {
  it('is deterministic', () => {
    for (const s of MIND_STATES) expect(grid(s)).toBe(grid(s));
  });
  it('is round: the corners are empty, the middle is not always', () => {
    for (const s of MIND_STATES) {
      expect(mindCell(s, 1.3, 0, 0, N, N, 1).ch).toBe(' ');
      expect(mindCell(s, 1.3, N - 1, N - 1, N, N, 1).ch).toBe(' ');
      for (let t = 0; t < 3; t += 0.5)
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++) {
            const nx = ((c + 0.5) / N) * 2 - 1;
            const ny = ((r + 0.5) / N) * 2 - 1;
            if (Math.hypot(nx, ny) > 1) expect(mindCell(s, t, c, r, N, N, 1).ch).toBe(' ');
          }
    }
    expect(mindCell('working', 1, 10, 10, N, N, 0).ch).not.toBe(' ');
  });
  it('differs per state', () => {
    const grids = MIND_STATES.map((s) => grid(s));
    expect(new Set(grids).size).toBe(MIND_STATES.length);
  });
  it('rest is a full shaded sphere, brighter at the top left than the bottom right', () => {
    const g = grid('rest', 1);
    expect(count(g)).toBeGreaterThan(N * N * 0.55);
    const light = (c: number, r: number) => mindCell('rest', 1, c, r, N, N).light;
    const tl = light(7, 6) + light(8, 7) + light(7, 7);
    const br = light(13, 14) + light(12, 13) + light(13, 13);
    expect(tl).toBeGreaterThan(br);
  });
  it('uses a wide range of the ramp without leaving it', () => {
    const used = new Set<string>();
    for (const s of MIND_STATES)
      for (let t = 0; t < 6; t += 0.31)
        for (const ch of grid(s, t)) if (ch !== ' ' && ch !== '\n') used.add(ch);
    for (const ch of used) expect(RAMP).toContain(ch);
    expect(used.size).toBeGreaterThanOrEqual(9);
  });
  it('keeps light in 0..1 and uses accent only for waiting and done', () => {
    for (const s of MIND_STATES)
      for (let t = 0; t < 4; t += 0.37)
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++) {
            const cell = mindCell(s, t, c, r, N, N, 1.4);
            expect(cell.light).toBeGreaterThanOrEqual(0);
            expect(cell.light).toBeLessThanOrEqual(1);
            if (cell.accent) expect(['waiting', 'done']).toContain(s);
          }
  });
  it('the sphere turns: the same cell changes over time', () => {
    expect(grid('rest', 0)).not.toBe(grid('rest', 4));
  });
  it('listening follows level, and louder rings reach further', () => {
    expect(grid('listening', 1, 0)).not.toBe(grid('listening', 1, 1));
    expect(mindParams('listening', 0, 1).ripple).toBeGreaterThan(
      mindParams('listening', 0, 0).ripple,
    );
    expect(mindParams('listening', 0, 1).radius).toBeGreaterThan(
      mindParams('listening', 0, 0).radius,
    );
  });
  it('thinking is faster and has a bright core; working has a ring', () => {
    expect(mindParams('thinking').spin).toBeGreaterThan(mindParams('rest').spin * 3);
    const core = mindCell('thinking', 1, 10, 10, N, N);
    const edge = mindCell('thinking', 1, 10, 3, N, N);
    expect(core.light).toBeGreaterThan(edge.light);
    expect(mindParams('working').ring).toBe(1);
    expect(mindParams('rest').ring).toBe(0);
  });
  it('waiting blinks one accent glyph in the centre and holds still', () => {
    expect(mindCell('waiting', 0, 10, 10, N, N, 0)).toMatchObject({ accent: true, ch: '@' });
    expect(mindCell('waiting', 0.7, 10, 10, N, N, 0).ch).toBe(' ');
    let accents = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (mindCell('waiting', 0, c, r, N, N).accent) accents++;
    expect(accents).toBe(1);
  });
  it('done sends a wave out from the centre, then settles', () => {
    expect(mindCell('done', 0, 10, 10, N, N).accent).toBe(true);
    expect(grid('done', 0)).not.toBe(grid('done', 5));
    let accents = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (mindCell('done', 5, c, r, N, N).accent) accents++;
    expect(accents).toBe(0);
    expect(mindParams('done', 0.6).waveR).toBeGreaterThan(mindParams('done', 0.2).waveR);
  });
  it('blends parameters between states without jumping', () => {
    const a = mindParams('rest', 1);
    const b = mindParams('thinking', 1);
    expect(blendParams(a, b, 0)).toEqual({ ...a, waveR: a.waveR });
    const half = blendParams(a, b, 0.5);
    expect(half.spin).toBeCloseTo((a.spin + b.spin) / 2);
    expect(half.core).toBeCloseTo(0.5);
    // A small step in the blend moves each cell's light only a little.
    const k1 = blendParams(a, b, 0.5);
    const k2 = blendParams(a, b, 0.52);
    let worst = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        worst = Math.max(
          worst,
          Math.abs(mindCellWith(k1, 1, c, r, N, N).light - mindCellWith(k2, 1, c, r, N, N).light),
        );
    expect(worst).toBeLessThan(0.15);
  });
  it('labels every state', () => {
    expect(mindLabel('thinking')).toBe('Remy is thinking');
    for (const s of MIND_STATES) expect(mindLabel(s)).toMatch(/^Remy is /);
  });
});

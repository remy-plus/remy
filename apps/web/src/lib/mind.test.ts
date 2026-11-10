import { describe, expect, it } from 'vitest';
import { MIND_STATES, type MindState, mindCell, mindLabel } from './mind.ts';

const N = 15;
const grid = (s: MindState, t = 1.3, level = 0.7) =>
  Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => mindCell(s, t, c, r, N, N, level).ch).join(''),
  ).join('\n');

describe('mind', () => {
  it('is deterministic', () => {
    for (const s of MIND_STATES) expect(grid(s)).toBe(grid(s));
  });
  it('is round: the corners are empty, the middle is not always', () => {
    for (const s of MIND_STATES) {
      expect(mindCell(s, 1.3, 0, 0, N, N, 1).ch).toBe(' ');
      expect(mindCell(s, 1.3, N - 1, N - 1, N, N, 1).ch).toBe(' ');
    }
    expect(mindCell('working', 1, 7, 7, N, N, 0).ch).not.toBe(' ');
  });
  it('differs per state', () => {
    const grids = MIND_STATES.map((s) => grid(s));
    expect(new Set(grids).size).toBe(MIND_STATES.length);
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
  it('listening follows level', () => {
    expect(grid('listening', 1, 0)).not.toBe(grid('listening', 1, 1));
  });
  it('waiting blinks one accent glyph in the centre', () => {
    expect(mindCell('waiting', 0, 7, 7, N, N, 0)).toMatchObject({ accent: true });
    expect(mindCell('waiting', 0.7, 7, 7, N, N, 0).ch).toBe(' ');
  });
  it('done flashes then settles', () => {
    expect(grid('done', 0)).not.toBe(grid('done', 5));
    expect(grid('done', 5)).not.toContain('@');
  });
  it('labels every state', () => {
    expect(mindLabel('thinking')).toBe('Remy is thinking');
    for (const s of MIND_STATES) expect(mindLabel(s)).toMatch(/^Remy is /);
  });
});

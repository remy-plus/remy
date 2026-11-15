import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 AA, measured on the real tokens: 4.5:1 for text, 3:1 for the edge of a control and for large text.
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const tokens = read('../../branding/tokens.css');
const app = read('src/index.css');

const hex = (css: string, name: string, scope = ':root'): string => {
  const block = css.slice(css.indexOf(scope));
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!m?.[1]) throw new Error(`--${name} is not a hex colour under ${scope}`);
  return m[1];
};
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ['bg', 'surface', 'raise'].map((n) => [n, hex(tokens, n)] as const);
const colour = (n: string) => (n === 'control' ? hex(app, n) : hex(tokens, n));

describe('colour contrast of the brand tokens', () => {
  it.each(SURFACES)('text is at least 7:1 on %s', (_n, bg) => {
    expect(ratio(colour('text'), bg)).toBeGreaterThanOrEqual(7);
  });
  it.each(SURFACES)('muted text is at least 4.5:1 on %s', (_n, bg) => {
    expect(ratio(colour('muted'), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SURFACES)('the accent, when used as text, is at least 4.5:1 on %s', (_n, bg) => {
    expect(ratio(colour('signal'), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SURFACES)('the edge of a field, switch or composer is at least 3:1 on %s', (_n, bg) => {
    expect(ratio(colour('control'), bg)).toBeGreaterThanOrEqual(3);
  });
  it('the ink on the accent fill (an on switch, a finished step) is at least 4.5:1', () => {
    expect(ratio(colour('signal-ink'), colour('signal'))).toBeGreaterThanOrEqual(4.5);
  });
});

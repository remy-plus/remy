import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { createTheme } from '../theme.ts';
import { type Row, TEXT_INDENT } from './rows.ts';
import { Viewport } from './viewport.ts';

const theme = createTheme('none');
const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
  spans: [{ text: `row ${i}` }],
  inset: TEXT_INDENT,
  pad: 0,
}));

describe('Viewport', () => {
  it('shows only the rows in view', () => {
    const app = render(h(Viewport, { rows, top: 4, height: 3, width: 20, theme }));
    expect(app.lastFrame()).toBe('   row 4\n   row 5\n   row 6');
    app.unmount();
  });

  it('draws a bar and keeps a row to one line', () => {
    const r: Row[] = [
      { spans: [{ text: 'x'.repeat(40) }], inset: 0, bar: 'accent', surface: 'panel', pad: 2 },
    ];
    const app = render(h(Viewport, { rows: r, top: 0, height: 2, width: 20, theme }));
    const lines = (app.lastFrame() ?? '').split('\n');
    expect(lines[0]?.startsWith('┃  x')).toBe(true);
    expect(lines[0]?.length).toBeLessThanOrEqual(20);
    app.unmount();
  });
});

import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { filterItems, Menu, menuRows, Picker, windowAround } from './picker.ts';
import { createTheme } from './theme.ts';

const items = [
  { id: 'a', title: 'gpt-5-nano', detail: 'openai' },
  { id: 'b', title: 'Switch the model', detail: '/model' },
  { id: 'c', title: 'Start a fresh conversation', detail: '/new' },
];
const theme = createTheme('none');
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('picker helpers', () => {
  it('keeps the highlighted row in view', () => {
    expect(windowAround(0, 20, 8)).toEqual({ start: 0, end: 8 });
    expect(windowAround(10, 20, 8)).toEqual({ start: 6, end: 14 });
    expect(windowAround(19, 20, 8)).toEqual({ start: 12, end: 20 });
    expect(windowAround(1, 3, 8)).toEqual({ start: 0, end: 3 });
  });

  it('counts the rows a menu takes, with the "more" line', () => {
    expect(menuRows(3)).toBe(3);
    expect(menuRows(12)).toBe(9);
  });

  it('matches ids loosely and sentences as written', () => {
    expect(filterItems(items, 'g5n').map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, 'conn')).toEqual([]);
    expect(filterItems(items, 'model').map((i) => i.id)).toEqual(['b']);
    expect(filterItems(items, '')).toEqual(items);
  });
});

describe('Menu and Picker', () => {
  it('marks the highlighted row with a glyph, not only with weight', () => {
    const app = render(h(Menu, { items, at: 1, theme }));
    const lines = (app.lastFrame() ?? '').split('\n');
    expect(lines[1]).toContain('›');
    expect(lines[0]).not.toContain('›');
    app.unmount();
  });

  it('filters as you type, picks with Enter and closes with Esc', async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const app = render(h(Picker, { title: 'Pick', items, theme, onPick, onCancel }));
    app.stdin.write('fresh');
    await tick();
    expect(app.lastFrame()).toContain('Start a fresh conversation');
    expect(app.lastFrame()).not.toContain('gpt-5-nano');
    app.stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), 'fresh');
    app.stdin.write('\x1b');
    await tick();
    expect(onCancel).toHaveBeenCalled();
    app.unmount();
  });

  it('says when nothing matches, and offers rows made from the query', async () => {
    const app = render(
      h(Picker, {
        title: 'Pick',
        items,
        theme,
        empty: 'Nothing here.',
        extra: (q) => [{ id: 'x', title: `Use "${q}"` }],
        onPick: () => {},
        onCancel: () => {},
      }),
    );
    app.stdin.write('zzz');
    await tick();
    expect(app.lastFrame()).toContain('Use "zzz"');
    app.unmount();
  });
});

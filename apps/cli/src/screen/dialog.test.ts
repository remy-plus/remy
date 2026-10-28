import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { createTheme } from '../theme.ts';
import { Dialog, dialogSize } from './dialog.ts';
import {
  type DialogItem,
  DialogList,
  dialogKey,
  initialDialogState,
  shownItems,
} from './dialog-list.ts';

const items: DialogItem[] = [
  { id: 'new', title: 'New session', detail: 'ctrl+n', group: 'Session' },
  { id: 'model', title: 'Switch model', detail: 'ctrl+m', group: 'Model' },
  { id: 'sessions', title: 'Sessions', group: 'Session' },
  { id: 'login', title: 'Log in', group: 'Account' },
];
const theme = createTheme('none', 'dark');

describe('dialogSize', () => {
  it('uses fixed widths capped to the screen', () => {
    expect(dialogSize(200, 40, 'small').width).toBe(60);
    expect(dialogSize(200, 40, 'medium').width).toBe(88);
    expect(dialogSize(200, 40, 'large').width).toBe(116);
    expect(dialogSize(80, 24, 'large').width).toBe(78);
  });
  it('centers and offsets by a quarter of the rows', () => {
    const g = dialogSize(100, 30, 'small');
    expect(g.top).toBe(7);
    expect(g.left).toBe(20);
    expect(g.listRows).toBeGreaterThan(3);
    expect(g.top + g.listRows).toBeLessThan(30);
  });
});

describe('dialogKey', () => {
  const ctx = { items };
  const s0 = initialDialogState;
  it('groups items while the query is empty', () => {
    expect(shownItems(items, '').map((i) => i.id)).toEqual(['new', 'sessions', 'model', 'login']);
  });
  it('moves with arrows and ctrl+n/p, wrapping', () => {
    expect(dialogKey(s0, '', { downArrow: true }, ctx).state.at).toBe(1);
    expect(dialogKey(s0, 'n', { ctrl: true }, ctx).state.at).toBe(1);
    expect(dialogKey(s0, '', { upArrow: true }, ctx).state.at).toBe(3);
    expect(dialogKey(s0, 'p', { ctrl: true }, ctx).state.at).toBe(3);
  });
  it('pages without wrapping', () => {
    expect(dialogKey(s0, '', { pageDown: true }, { items, page: 10 }).state.at).toBe(3);
    expect(dialogKey(s0, '', { pageUp: true }, ctx).state.at).toBe(0);
  });
  it('types and erases the query, resetting the highlight', () => {
    const t = dialogKey({ query: 'a', at: 2 }, 'b', {}, ctx).state;
    expect(t).toEqual({ query: 'ab', at: 0 });
    expect(dialogKey(t, '', { backspace: true }, ctx).state.query).toBe('a');
  });
  it('ignores control combos', () => {
    expect(dialogKey(s0, 'x', { ctrl: true }, ctx).state).toEqual(s0);
  });
  it('picks the highlighted item and closes on esc', () => {
    expect(dialogKey({ query: '', at: 2 }, '', { return: true }, ctx).action).toEqual({
      type: 'pick',
      item: items[1],
    });
    expect(dialogKey(s0, '', { escape: true }, ctx).action).toEqual({ type: 'close' });
    expect(dialogKey({ query: 'zzzz', at: 0 }, '', { return: true }, ctx).action).toBeUndefined();
  });
});

const frame = (columns: number, rows: number, query: string, at = 0) => {
  const g = dialogSize(columns, rows, 'small');
  const { lastFrame, unmount } = render(
    h(
      Box,
      { width: columns, height: rows },
      h(
        Dialog,
        { title: 'Commands', theme, columns, rows, size: 'small' },
        h(DialogList, { items, state: { query, at }, theme, width: g.inner, rows: g.listRows }),
      ),
    ),
  );
  const out = lastFrame() ?? '';
  unmount();
  return out;
};

describe('Dialog frames', () => {
  for (const [c, r] of [
    [100, 30],
    [80, 24],
  ] as const) {
    it(`shows a grouped list at ${c}x${r}`, () => {
      const out = frame(c, r, '');
      expect(out).toContain('Commands');
      expect(out).toContain('esc');
      expect(out).toContain('Search');
      expect(out.indexOf('Session')).toBeLessThan(out.indexOf('New session'));
      expect(out).toContain('Account');
      expect(out).toMatch(/› New session\s+ctrl\+n/);
      for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(c);
    });
    it(`shows a filtered list at ${c}x${r}`, () => {
      const out = frame(c, r, 'mod');
      expect(out).toContain('Switch model');
      expect(out).not.toContain('Log in');
      expect(out).not.toContain('Account');
    });
    it(`shows the empty state at ${c}x${r}`, () => {
      expect(frame(c, r, 'qqqq')).toContain('No matches');
    });
  }
});

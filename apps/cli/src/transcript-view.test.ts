import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Item } from './chat.ts';
import { createTheme } from './theme.ts';
import { toolDetail } from './transcript.ts';
import {
  clampTop,
  findMatches,
  flattenItems,
  startState,
  stepMatch,
  TranscriptView,
  viewKey,
  viewPage,
} from './transcript-view.ts';

const theme = createTheme('none');
const tool = (target: string, detail?: string[], ms = 12): Item => ({
  kind: 'tool',
  line: {
    callId: target,
    tool: 'read_file',
    verb: 'read',
    target,
    state: 'ok',
    ms,
    count: 1,
    detail,
  },
});
const items: Item[] = [
  { kind: 'user', text: 'tidy my notes' },
  tool('a.txt', ['alpha line', 'beta line']),
  tool('b.txt', ['gamma line'], 2400),
  { kind: 'reply', text: 'All tidy.' },
];

describe('toolDetail', () => {
  it('keeps the first lines of output and says how many were left out', () => {
    const content = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const d = toolDetail('read_file', {}, { ok: true, content, trust: 'trusted' });
    expect(d).toHaveLength(9);
    expect(d?.[8]).toBe('... 4 more lines');
  });
  it('shows an edit as hunks and nothing for a failure', () => {
    expect(
      toolDetail(
        'edit_file',
        { old: 'a\nb', new: 'c' },
        { ok: true, content: 'ok', trust: 'trusted' },
      ),
    ).toEqual(['- a', '- b', '+ c']);
    expect(
      toolDetail(
        'read_file',
        {},
        { ok: false, error: 'x', retryable: false, phase: 'before_effect' },
      ),
    ).toBeUndefined();
  });
});

describe('window math and search', () => {
  const rows = flattenItems(items, theme, 80);
  it('expands details and keeps elapsed time of slow tools', () => {
    const text = rows.map((r) => r.text).join('\n');
    expect(text).toContain('alpha line');
    expect(text).toContain('b.txt  2.4s');
  });
  it('clamps the window and opens at the end', () => {
    expect(clampTop(50, 10, 4)).toBe(6);
    expect(clampTop(-3, 10, 4)).toBe(0);
    expect(startState(rows.length, 4).top).toBe(rows.length - 4);
    expect(viewPage(24)).toBe(22);
  });
  it('finds matches and steps through them, wrapping', () => {
    const m = findMatches(rows, 'LINE');
    expect(m).toHaveLength(3);
    expect(stepMatch(m, m[2] as number, 1)).toBe(m[0]);
    expect(stepMatch(m, m[0] as number, -1)).toBe(m[2]);
    expect(stepMatch([], 0, 1)).toBeUndefined();
  });
  it('scrolls, searches and closes by key', () => {
    let st = { ...startState(rows.length, 4), top: 0 };
    const step = (ch: string, key = {}) => {
      const a = viewKey(st, ch, key, rows, 4);
      if ('state' in a) st = a.state;
      return a;
    };
    step('j');
    expect(st.top).toBe(1);
    step('', { upArrow: true });
    step('k');
    expect(st.top).toBe(0);
    step('/');
    for (const c of 'gamma') step(c);
    step('', { return: true });
    expect(st.matches).toHaveLength(1);
    expect(st.top).toBe(clampTop(st.matches[0] as number, rows.length, 4));
    expect(step('', { escape: true })).toHaveProperty('state');
    expect(st.query).toBe('');
    expect(step('q')).toEqual({ close: true });
    expect(step('[')).toEqual({ dump: true });
  });
});

describe('TranscriptView', () => {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  it('renders only the rows that fit and leaves with q', async () => {
    const onClose = vi.fn();
    const many: Item[] = Array.from({ length: 40 }, (_, i) => tool(`file${i}.txt`, [`d${i}`]));
    const app = render(h(TranscriptView, { items: many, columns: 60, rows: 12, theme, onClose }));
    expect((app.lastFrame() ?? '').split('\n')).toHaveLength(11);
    expect(app.lastFrame()).toContain('d39');
    expect(app.lastFrame()).not.toContain('file0.txt');
    app.stdin.write('g');
    await tick();
    expect(app.lastFrame()).toContain('file0.txt');
    app.stdin.write('q');
    await tick();
    expect(onClose).toHaveBeenCalledWith();
    app.unmount();
  });
  it('hands everything, details included, to scrollback on [', async () => {
    const onClose = vi.fn();
    const app = render(h(TranscriptView, { items, columns: 60, rows: 12, theme, onClose }));
    app.stdin.write('[');
    await tick();
    const dump = onClose.mock.calls[0]?.[0] as string;
    expect(dump).toContain('alpha line');
    expect(dump).toContain('All tidy.');
    app.unmount();
  });
});

import { describe, expect, it } from 'vitest';
import type { Item } from '../chat.ts';
import { createTheme } from '../theme.ts';
import type { ToolLine } from '../transcript.ts';
import { buildRows, createRowCache, NO_LIVE } from './compose.ts';
import { rowText } from './rows.ts';

const theme = createTheme('none');
const line = (n: number, o: Partial<ToolLine> = {}): ToolLine => ({
  callId: `c${n}`,
  tool: 'read_file',
  verb: 'read',
  target: `f${n}.ts`,
  state: 'ok',
  count: 1,
  ...o,
});
const build = (items: Item[], live = NO_LIVE, width = 50, cache = createRowCache()) =>
  buildRows(cache, items, live, width, theme).map(rowText);

describe('buildRows', () => {
  it('separates messages by one blank row', () => {
    const t = build([
      { kind: 'user', text: 'hi' },
      { kind: 'reply', text: 'Hello.' },
    ]);
    expect(t).toEqual(['┃', '┃  hi', '┃', '', '   Hello.']);
  });

  it('keeps a run of one-line tools together', () => {
    const t = build([
      { kind: 'text', text: 'Looking.' },
      { kind: 'tool', line: line(1) },
      { kind: 'tool', line: line(2) },
    ]);
    expect(t).toEqual(['   Looking.', '', '   → read f1.ts', '   → read f2.ts']);
  });

  it('sets a tool with a body apart from its neighbours', () => {
    const edit = line(2, { tool: 'edit_file', verb: 'edit', detail: ['+ x'] });
    const t = build([
      { kind: 'tool', line: line(1) },
      { kind: 'tool', line: edit },
      { kind: 'tool', line: line(3) },
    ]);
    expect(t[1]).toBe('');
    expect(t.at(-2)).toBe('');
  });

  it('adds the live turn after the items: stream, tools, thinking, queue', () => {
    const t = build([{ kind: 'user', text: 'go' }], {
      ...NO_LIVE,
      streaming: 'Working on it',
      tools: [line(1, { state: 'running' })],
      thinking: 'Thinking: plan',
      queue: ['next'],
      spinner: '⠋',
    });
    expect(t.slice(4)).toEqual([
      '   Working on it',
      '',
      '   ⠋ read f1.ts',
      '',
      '   ⠋ Thinking: plan',
      '',
      '   › next  queued',
    ]);
  });

  it('reuses the rows of a finished item until the width changes', () => {
    const cache = createRowCache();
    const item: Item = { kind: 'text', text: 'one two three four five six seven eight nine' };
    buildRows(cache, [item], NO_LIVE, 30, theme);
    const first = cache.items.get(item)?.rows;
    buildRows(cache, [item], NO_LIVE, 30, theme);
    expect(cache.items.get(item)?.rows).toBe(first);
    buildRows(cache, [item], NO_LIVE, 20, theme);
    expect(cache.items.get(item)?.rows).not.toBe(first);
  });

  it('wraps only the last paragraph again while text streams', () => {
    const cache = createRowCache();
    const live = (streaming: string) => ({ ...NO_LIVE, streaming });
    buildRows(cache, [], live('First paragraph.\n\nSecond'), 40, theme);
    const head = cache.head.rows;
    expect(head.map(rowText)).toEqual(['   First paragraph.']);
    const t = buildRows(cache, [], live('First paragraph.\n\nSecond one grows'), 40, theme).map(
      rowText,
    );
    expect(cache.head.rows).toBe(head);
    expect(t).toEqual(['   First paragraph.', '', '   Second one grows']);
  });

  it('does not split streaming text inside an open code fence', () => {
    const cache = createRowCache();
    buildRows(cache, [], { ...NO_LIVE, streaming: '```\na\n\nb' }, 40, theme);
    expect(cache.head.rows).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { strWidth } from '../markdown.ts';
import { createTheme } from '../theme.ts';
import type { ToolLine } from '../transcript.ts';
import { fitSpans, itemRows, rowText, toolRows } from './rows.ts';

const theme = createTheme('none');
const tool = (o: Partial<ToolLine>): ToolLine => ({
  callId: 'c1',
  tool: 'read_file',
  verb: 'read',
  target: 'src/a.ts',
  state: 'ok',
  count: 1,
  ...o,
});
const text = (rows: ReturnType<typeof itemRows>) => rows.map(rowText);

describe('rows', () => {
  it('sets a user message in a bar and panel with a padding row above and below', () => {
    const rows = itemRows({ kind: 'user', text: 'fix the failing test' }, 40, theme);
    expect(text(rows)).toEqual(['┃', '┃  fix the failing test', '┃']);
    expect(rows.every((r) => r.surface === 'panel' && r.bar === 'accent')).toBe(true);
  });

  it('wraps a long user message inside the panel', () => {
    const rows = itemRows({ kind: 'user', text: 'word '.repeat(30).trim() }, 30, theme);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(strWidth(rowText(r))).toBeLessThanOrEqual(30);
  });

  it('indents assistant text three columns and wraps it to the width', () => {
    const rows = itemRows({ kind: 'text', text: 'one two three four five six seven' }, 20, theme);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(rowText(r).startsWith('   ')).toBe(true);
      expect(strWidth(rowText(r))).toBeLessThanOrEqual(20);
    }
  });

  it('ends a reply with a muted model and time footer', () => {
    const rows = itemRows(
      { kind: 'reply', text: 'Done.', model: 'gpt-5-nano', ms: 12_400 },
      60,
      theme,
    );
    expect(text(rows)).toEqual(['   Done.', '', '   ▣ gpt-5-nano · 12s']);
    expect(rows.at(-1)?.spans[0]?.role).toBe('muted');
    expect(text(itemRows({ kind: 'reply', text: 'Done.' }, 60, theme))).toEqual(['   Done.']);
  });

  it('shows a tool call on one line with a two-wide glyph', () => {
    expect(text(toolRows(tool({}), 60, theme))).toEqual(['   → read src/a.ts']);
    const run = tool({ tool: 'run_command', verb: 'run', target: 'pnpm test', state: 'running' });
    expect(text(toolRows(run, 60, theme, '⠋'))).toEqual(['   ⠋ pnpm test']);
    expect(text(toolRows(run, 60, theme))).toEqual(['   $ pnpm test']);
  });

  it('colours a failed call and strikes a denied one', () => {
    const failed = toolRows(tool({ state: 'failed', reason: 'not found' }), 60, theme)[0];
    expect(failed?.spans.some((s) => s.role === 'error')).toBe(true);
    expect(rowText(failed as never)).toContain('not found');
    const denied = toolRows(tool({ state: 'denied' }), 60, theme)[0];
    expect(denied?.spans.some((s) => s.strike)).toBe(true);
  });

  it('cuts a long tool line to the width', () => {
    const rows = toolRows(tool({ target: 'x'.repeat(100) }), 30, theme);
    expect(strWidth(rowText(rows[0] as never))).toBeLessThanOrEqual(30);
    expect(rowText(rows[0] as never).endsWith('…')).toBe(true);
  });

  it('puts an edit in a panel block below its line', () => {
    const rows = toolRows(
      tool({ tool: 'edit_file', verb: 'edit', detail: ['- old', '+ new'] }),
      60,
      theme,
    );
    expect(rows.length).toBe(1 + 1 + 2 + 1);
    expect(rows.slice(1).every((r) => r.surface === 'panel')).toBe(true);
    expect(rows[3]?.spans[0]?.role).toBe('diffAdd');
  });

  it('collapses a long body to ten lines and points at ctrl+o', () => {
    const detail = Array.from({ length: 14 }, (_, i) => `line ${i}`);
    const rows = toolRows(
      tool({ tool: 'run_command', verb: 'run', target: 'ls', detail }),
      60,
      theme,
    );
    const t = text(rows);
    expect(t.some((l) => l.includes('line 8'))).toBe(true);
    expect(t.some((l) => l.includes('line 10'))).toBe(false);
    expect(t.some((l) => l.includes('… 5 more lines (ctrl+o)'))).toBe(true);
  });

  it('rewrites the recorded "more lines" marker with the key', () => {
    const rows = toolRows(
      tool({ tool: 'run_command', verb: 'run', target: 'ls', detail: ['a', '... 3 more lines'] }),
      60,
      theme,
    );
    expect(text(rows).join('\n')).toContain('… 3 more lines (ctrl+o)');
  });

  it('shows the time of a slow call and not of a quick one', () => {
    expect(rowText(toolRows(tool({ ms: 40 }), 60, theme)[0] as never)).toBe('   → read src/a.ts');
    expect(rowText(toolRows(tool({ ms: 2400 }), 60, theme)[0] as never)).toContain('2.4s');
  });

  it('does not open a body for a read or a write', () => {
    expect(
      toolRows(tool({ tool: 'write_file', detail: ['Wrote 8 characters'] }), 60, theme),
    ).toHaveLength(1);
    expect(toolRows(tool({ detail: ['x'] }), 60, theme)).toHaveLength(1);
  });

  it('puts an error behind a bar in the error colour role', () => {
    const rows = itemRows({ kind: 'error', text: 'Network is down.' }, 40, theme);
    expect(rows[0]?.bar).toBe('error');
    expect(text(rows)[1]).toBe('┃  Network is down.');
  });

  it('lists plan steps with their state', () => {
    const rows = itemRows(
      {
        kind: 'plan',
        steps: [
          { text: 'find', status: 'done' },
          { text: 'write', status: 'pending' },
        ],
      },
      40,
      theme,
    );
    expect(text(rows)).toEqual(['   ● find', '   ○ write']);
  });

  it('fits spans with an ellipsis', () => {
    const out = fitSpans([{ text: 'abcdef' }, { text: 'ghij' }], 8);
    expect(out.map((s) => s.text).join('')).toBe('abcdefg…');
  });
});

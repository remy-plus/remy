import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { createTheme } from '../theme.ts';
import { WORDMARK, WORDMARK_WIDTH } from '../wordmark.ts';
import { Home, shortenPath } from './home.ts';
import { pickTip, TIPS } from './tips.ts';

const theme = createTheme('none');
const frame = (columns: number, rows: number, extra: Record<string, unknown> = {}) =>
  render(
    h(Home, {
      theme,
      columns,
      rows,
      prompt: h(Text, null, '> ask'),
      version: '0.3.0',
      workspace: '/work/notes',
      tip: 'Ctrl+P opens the command palette',
      ...extra,
    } as never),
  ).lastFrame() ?? '';

describe('tips', () => {
  it('has a handful of calm tips and a stable pick', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(6);
    for (const t of TIPS) expect(t).not.toContain('!');
    expect(pickTip(3)).toBe(pickTip(3));
    expect(pickTip(TIPS.length)).toBe(TIPS[0]);
    expect(pickTip(-1)).toBeTruthy();
  });
});

describe('personalised tips', () => {
  it('every other pick comes from the goals, the rest from the general tips', () => {
    const mine = ['Paste a link and ask Remy to summarise the page'];
    expect(pickTip(0, mine)).toBe(mine[0]);
    expect(pickTip(2, mine)).toBe(mine[0]);
    expect(TIPS).toContain(pickTip(1, mine));
    expect(pickTip(7, [])).toBe(pickTip(7));
  });
});

describe('home greeting', () => {
  for (const [cols, rows] of [
    [100, 30],
    [80, 24],
  ] as const) {
    it(`greets under the wordmark at ${cols}x${rows}`, () => {
      const out = frame(cols, rows, { greeting: 'Good evening, Sam.' });
      const lines = out.split('\n');
      expect(lines.length).toBeLessThanOrEqual(rows);
      const mark = lines.findIndex((l) => l.includes(WORDMARK[5]?.trim() as string));
      const hello = lines.findIndex((l) => l.includes('Good evening, Sam.'));
      const prompt = lines.findIndex((l) => l.includes('> ask'));
      expect(mark).toBeGreaterThanOrEqual(0);
      expect(hello).toBeGreaterThan(mark);
      expect(prompt).toBeGreaterThan(hello);
      expect(out).toContain('Tip');
    });
  }
  it('shows nothing extra without a profile', () => {
    expect(frame(100, 30)).not.toContain('Good ');
  });
});

describe('home', () => {
  it('shows the ctrl+p commands hint under the prompt', () => {
    const lines = frame(100, 30).split('\n');
    const at = lines.findIndex((l) => l.includes('> ask'));
    expect(lines[at + 1]).toContain('ctrl+p commands');
  });

  it('caps the footer workspace path to about 40% of the width', () => {
    const long = '/work/a-very-long-directory-name/another-long-directory/and-one-more/project';
    const out = frame(100, 30, { workspace: long });
    const last = out
      .split('\n')
      .filter((l) => l.includes('v0.3.0'))
      .pop() as string;
    const path = last.replace('v0.3.0', '').trim();
    expect(path.startsWith('…')).toBe(true);
    expect(path.length).toBeLessThanOrEqual(40);
    expect(path.endsWith('project')).toBe(true);
  });

  it('draws the wordmark centred at 100x30', () => {
    const out = frame(100, 30);
    const lines = out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(30);
    const first = lines.find((l) => l.includes(WORDMARK[0]?.trim() as string)) as string;
    const left = first.length - first.trimStart().length;
    expect(Math.abs(left - (100 - WORDMARK_WIDTH) / 2)).toBeLessThanOrEqual(2);
    expect(out).toContain('> ask');
  });

  it('shows the tip with the dot, and hides it when absent', () => {
    expect(frame(100, 30)).toContain('● Tip Ctrl+P opens the command palette');
    expect(frame(100, 30, { tip: undefined })).not.toContain('Tip');
  });

  it('puts the workspace left and the version right in the footer', () => {
    const last = frame(100, 30)
      .split('\n')
      .filter((l) => l.trim())
      .at(-1) as string;
    expect(last.startsWith('  /work/notes')).toBe(true);
    expect(last.trimEnd().endsWith('v0.3.0')).toBe(true);
  });

  it('keeps the wordmark and tip at 80x24, drops the tip at 80x20', () => {
    const out = frame(80, 24);
    expect(out).toContain(WORDMARK[0]?.trim());
    expect(out).toContain('Tip');
    expect(frame(80, 20)).not.toContain('Tip');
  });

  it('falls back to one line REMY at 60x16', () => {
    const out = frame(60, 16);
    expect(out).toContain('REMY');
    expect(out).not.toContain(WORDMARK[0]?.trim());
    expect(out).not.toContain('Tip');
    expect(out).toContain('v0.3.0');
  });

  it('falls back when too narrow for the wordmark', () => {
    expect(frame(WORDMARK_WIDTH + 3, 30)).not.toContain(WORDMARK[0]?.trim());
  });

  it('shows a notice under the prompt', () => {
    expect(frame(100, 30, { notice: 'Update available' })).toContain('Update available');
  });

  it('shortens the home directory', () => {
    expect(shortenPath('/Users/me/work', 40, '/Users/me')).toBe('~/work');
    expect(shortenPath('/a/very/long/path/here', 8, '/x')).toHaveLength(8);
  });
});

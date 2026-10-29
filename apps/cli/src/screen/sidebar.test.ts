import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { createTheme } from '../theme.ts';
import {
  contextBar,
  contextLines,
  Sidebar,
  type SidebarState,
  shortenPath,
  sidebarMode,
  wrapTitle,
} from './sidebar.ts';

const base: SidebarState = {
  contextTokens: 0,
  inTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  taskCostUsd: 0,
};

const frame = (state: SidebarState, height: number) => {
  const app = render(h(Sidebar, { state, theme: createTheme('none'), height }));
  const out = app.lastFrame() ?? '';
  app.unmount();
  return out;
};

describe('helpers', () => {
  it('sidebarMode switches above 120 columns', () => {
    expect(sidebarMode(120)).toBe('hidden');
    expect(sidebarMode(121)).toBe('inline');
  });

  it('shortenPath cuts from the left and fits the width', () => {
    expect(shortenPath('src/a.ts', 20)).toBe('src/a.ts');
    const cut = shortenPath('packages/core/src/deep/file.ts', 12);
    expect(cut).toBe('…eep/file.ts');
    expect(cut).toHaveLength(12);
    expect(shortenPath('abc', 1)).toBe('…');
    expect(shortenPath('abc', 0)).toBe('');
  });

  it('contextBar fills in proportion', () => {
    expect(contextBar(0, 1000, 10)).toEqual({ filled: 0, empty: 10 });
    expect(contextBar(140, 1000, 10)).toEqual({ filled: 1, empty: 9 });
    expect(contextBar(1, 1000, 10)).toEqual({ filled: 1, empty: 9 });
    expect(contextBar(5000, 1000, 10)).toEqual({ filled: 10, empty: 0 });
    expect(contextBar(5, undefined, 10)).toEqual({ filled: 0, empty: 10 });
  });

  it('wrapTitle wraps to two lines with an ellipsis', () => {
    expect(wrapTitle('short', 20)).toEqual(['short']);
    expect(wrapTitle('one two three', 8)).toEqual(['one two', 'three']);
    const long = wrapTitle('word '.repeat(40), 10);
    expect(long).toHaveLength(2);
    expect(long[1]?.endsWith('…')).toBe(true);
  });

  it('contextLines states tokens, percent and spend', () => {
    const s = { ...base, contextTokens: 12345, contextWindow: 88000, costUsd: 0.04 };
    expect(contextLines(s)).toEqual({ tokens: '12,345 tokens · 14% used', cost: '$0.04 spent' });
    expect(contextLines({ ...s, budgetUsd: 0.5, taskCostUsd: 0.04 }).cost).toBe('$0.04 of $0.50');
  });

  it('contextLines adds the cached share once the provider reports one', () => {
    const s = { ...base, contextTokens: 1000, inTokens: 4000, cachedTokens: 3000 };
    expect(contextLines(s).tokens).toBe('1,000 tokens · 75% cached');
  });
});

describe('Sidebar', () => {
  it('shows an empty session', () => {
    const out = frame({ ...base, model: 'test-model' }, 20);
    expect(out).toContain('New session');
    expect(out).toContain('CONTEXT');
    expect(out).toContain('0 tokens');
    expect(out).not.toContain('PLAN');
    expect(out).not.toContain('FILES');
    expect(out).toContain('test-model');
  });

  it('shows a busy session with plan and files', () => {
    const out = frame(
      {
        ...base,
        title: 'Tidy the invoices folder',
        contextTokens: 12345,
        contextWindow: 88000,
        costUsd: 0.04,
        plan: [
          { text: 'Read invoices', status: 'done' },
          { text: 'Rename files', status: 'doing' },
          { text: 'Write summary', status: 'pending' },
        ],
        filesTouched: [
          { path: 'invoices/2026/october/very-long-customer-name-invoice-0001.pdf', edits: 3 },
          { path: 'summary.md', edits: 1 },
        ],
        model: 'test-model',
      },
      30,
    );
    expect(out).toContain('Tidy the invoices folder');
    expect(out).toContain('12,345 tokens · 14% used');
    expect(out).toContain('$0.04 spent');
    expect(out).toContain('▰');
    expect(out).toContain('● Read invoices');
    expect(out).toContain('◐ Rename files');
    expect(out).toContain('○ Write summary');
    expect(out).toContain('summary.md');
    expect(out).toMatch(/…\S*0001\.pdf\s+3/);
    expect(out.split('\n').length).toBeLessThanOrEqual(30);
  });

  it('caps long lists with +N more', () => {
    const out = frame(
      {
        ...base,
        plan: Array.from({ length: 10 }, (_, i) => ({
          text: `step ${i}`,
          status: 'pending' as const,
        })),
        filesTouched: Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.ts`, edits: 1 })),
      },
      50,
    );
    expect(out.match(/\+2 more/g)).toHaveLength(2);
    expect(out).not.toContain('step 8');
    expect(out).not.toContain('f10.ts');
  });

  it('drops sections from the bottom on a tiny height', () => {
    const out = frame(
      {
        ...base,
        title: 'Tiny',
        contextTokens: 100,
        contextWindow: 1000,
        plan: [{ text: 'only step', status: 'doing' }],
        filesTouched: [{ path: 'a.ts', edits: 1 }],
        model: 'm',
      },
      11,
    );
    expect(out).toContain('Tiny');
    expect(out).toContain('CONTEXT');
    expect(out).not.toContain('PLAN');
    expect(out).not.toContain('FILES');
  });
});

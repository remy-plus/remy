// The minimal screen: the 0.2 scrollback UI without the wordmark, drawn with ink-testing-library.
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { ChatApp } from './chat-ui.ts';
import { createTheme } from './theme.ts';
import { TAGLINE, WORDMARK } from './wordmark.ts';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

function mount(minimal: boolean) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient([
    {
      calls: [{ tool: 'finish', args: { answer: 'Four.' } }],
      usage: { inTokens: 1200, outTokens: 50 },
    },
  ]);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'minimal-ui',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        ...hooks,
      }),
    config: (context) => ({
      model: 'test',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/tmp',
      context,
    }),
    release: releaseLease(store, 'minimal-ui'),
    model: 'gpt-5-nano',
    contextWindow: 128_000,
  });
  const app = render(
    h(ChatApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'gpt-5-nano',
      workspace: '/work/notes',
      minimal,
    }),
  );
  return { chat, app, frame: () => app.lastFrame() ?? '' };
}

describe('minimal screen', () => {
  it('has no wordmark, tagline or examples; one quiet line says model and workspace', async () => {
    const m = mount(true);
    await tick();
    const f = m.frame();
    expect(f).not.toContain(TAGLINE);
    expect(f).not.toContain(WORDMARK[0]?.trim() ?? '###');
    expect(f).not.toContain('Ask in your own words');
    expect(f).toContain('gpt-5-nano · /work/notes');
    m.app.unmount();
  });

  it('keeps one footer line without cost or context figures, and the transcript', async () => {
    const m = mount(true);
    await m.chat.submit('what is 2+2');
    await until(() => m.frame().includes('Four.'));
    const f = m.frame();
    expect(f).toContain('Four.');
    const footer = f.split('\n').filter((l) => l.includes('gpt-5-nano') && !l.includes('/work'));
    expect(footer).toHaveLength(1);
    expect(footer[0]).not.toMatch(/\$|%|tokens/);
    m.app.unmount();
  });

  it('the default header still carries the wordmark tagline', async () => {
    const m = mount(false);
    await tick();
    expect(m.frame()).toContain(TAGLINE);
    m.app.unmount();
  });
});

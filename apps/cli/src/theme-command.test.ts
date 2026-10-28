// /theme and its aliases: the controller, the picker in both screens, and the live switch.
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type ChatDeps, createChat, releaseLease } from './chat.ts';
import { ChatApp } from './chat-ui.ts';
import { matchCommands } from './commands.ts';
import type { ThemeChoice } from './prefs.ts';
import { FullApp } from './screen/full-app.ts';
import { createTheme } from './theme.ts';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

function make(extra: Partial<ChatDeps> = {}) {
  const store = new MemoryEventStore();
  return createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model: new ScriptedModelClient([]),
        tools: new ToolRegistry([finish]),
        owner: 'theme-test',
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
    release: releaseLease(store, 'theme-test'),
    model: 'gpt-5-nano',
    ...extra,
  });
}

const notes = (chat: ReturnType<typeof make>) =>
  chat.getState().items.flatMap((i) => (i.kind === 'note' || i.kind === 'error' ? [i.text] : []));

describe('/theme', () => {
  it('sets, saves and confirms; aliases map to light and dark', async () => {
    const saved: ThemeChoice[] = [];
    const chat = make({ saveTheme: (c) => saved.push(c) > 0 });
    expect(chat.getState().theme).toBe('auto');
    await chat.submit('/theme light');
    expect(chat.getState().theme).toBe('light');
    expect(notes(chat).at(-1)).toBe('Theme: light. Saved for next time.');
    await chat.submit('/night');
    expect(chat.getState().theme).toBe('dark');
    await chat.submit('/day');
    expect(chat.getState().theme).toBe('light');
    await chat.submit('/theme auto');
    expect(chat.getState().theme).toBe('auto');
    expect(saved).toEqual(['light', 'dark', 'light', 'auto']);
  });

  it('starts on the saved choice, says when it could not save, rejects unknown words', async () => {
    const chat = make({ theme: 'dark', saveTheme: () => false });
    expect(chat.getState().theme).toBe('dark');
    await chat.submit('/light');
    expect(notes(chat).at(-1)).toBe('Theme: light. Not saved.');
    await chat.submit('/theme pink');
    expect(notes(chat).at(-1)).toContain('There is no theme "pink"');
    expect(chat.getState().theme).toBe('light');
  });

  it('opens the picker without an argument and is found in the command list', async () => {
    const chat = make();
    await chat.submit('/theme');
    expect(chat.getState().overlay).toBe('theme');
    expect(matchCommands('night').map((c) => c.name)).toContain('theme');
  });
});

describe('/theme on screen', () => {
  const themeFor = () =>
    vi.fn((c: ThemeChoice) => createTheme('none', c === 'light' ? 'light' : 'dark'));

  it('classic: the picker marks the choice in use and a pick re-themes the app', async () => {
    const chat = make({ theme: 'dark' });
    const tf = themeFor();
    const app = render(
      h(ChatApp, { chat, theme: createTheme('none'), themeFor: tf, reducedMotion: true }),
    );
    await chat.submit('/theme');
    await until(() => (app.lastFrame() ?? '').includes('Dark'));
    expect(app.lastFrame()).toMatch(/Dark.*in use/);
    expect(tf).not.toHaveBeenCalledWith('light');
    app.stdin.write('\x1b[B');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().theme !== 'dark');
    expect(chat.getState().theme).toBe('light');
    await until(() => tf.mock.calls.some((c) => c[0] === 'light'));
    expect(app.lastFrame()).toContain('Theme: light.');
    app.unmount();
  });

  it('full screen: the dialog lists the choices and a pick applies it', async () => {
    const chat = make();
    const tf = themeFor();
    const app = render(
      h(FullApp, { chat, theme: createTheme('none'), themeFor: tf, reducedMotion: true }),
    );
    await chat.submit('/theme');
    await until(() => (app.lastFrame() ?? '').includes('Auto'));
    const frame = app.lastFrame() ?? '';
    expect(frame).toMatch(/Auto.*in use/);
    expect(frame).toContain('Light');
    expect(frame).toContain('Dark');
    app.stdin.write('\x1b[B');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().theme !== 'auto');
    expect(chat.getState().theme).toBe('light');
    await until(() => tf.mock.calls.some((c) => c[0] === 'light'));
    app.unmount();
  });
});

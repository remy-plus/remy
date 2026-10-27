// The screen side of the ease-of-use work, drawn with ink-testing-library.
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { type ChatDeps, createChat, releaseLease } from './chat.ts';
import { ChatApp, hintsFor } from './chat-ui.ts';
import { createTheme } from './theme.ts';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

function mount(extra: Partial<ChatDeps> = {}) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient([
    { calls: [{ tool: 'finish', args: { answer: 'Hi.' } }], usage: { inTokens: 1, outTokens: 1 } },
  ]);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'ease-ui',
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
    release: releaseLease(store, 'ease-ui'),
    model: 'gpt-5-nano',
    connect: {
      providers: () => [
        { id: 'openai', label: 'OpenAI', needsKey: true, keyUrl: 'platform.openai.com/api-keys' },
      ],
      models: () => [
        { provider: 'openai', model: 'gpt-5-nano', detail: '$0.05 in, $0.4 out per M' },
        { provider: 'openai', model: 'gpt-4o', detail: '$2.5 in, $10 out per M' },
      ],
      login: async () => ({ ok: true, message: 'Connected.', model: 'gpt-5-nano' }),
      use: async (provider, m) => ({
        ok: true,
        message: `Now using ${m} on ${provider}.`,
        model: m,
      }),
    },
    files: {
      list: async () => [
        { name: 'notes.txt', dir: false },
        { name: 'src', dir: true },
      ],
      read: async () => 'x',
    },
    ...extra,
  });
  const app = render(
    h(ChatApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'model' in extra ? extra.model : 'gpt-5-nano',
    }),
  );
  const frame = () => app.lastFrame() ?? '';
  return { chat, app, frame };
}

describe('footer hints', () => {
  it('adapt to what can be done now', () => {
    expect(hintsFor({ phase: 'idle', hasInput: false, fresh: true })).toContain('@ file');
    expect(hintsFor({ phase: 'idle', hasInput: false })).toContain('Ctrl+P');
    expect(hintsFor({ phase: 'idle', hasInput: false, unconnected: true })).toContain('/login');
    expect(hintsFor({ phase: 'idle', hasInput: true, menu: 'slash' })).toContain('Tab complete');
    expect(hintsFor({ phase: 'idle', hasInput: true, menu: 'file' })).toContain('attach');
    expect(hintsFor({ phase: 'idle', hasInput: false, overlay: true })).toBe('');
    expect(hintsFor('running', false)).toContain('Ctrl+C stop');
  });
});

describe('first run', () => {
  it('opens the login panel with a reason, and the footer says what to do', async () => {
    const { app, frame } = mount({ model: undefined });
    await tick();
    expect(frame()).toContain('Connect a model provider');
    expect(frame()).toContain('Remy needs a model to think with');
    expect(frame()).toContain('not connected');
    expect(frame()).not.toContain('Esc close');
    app.unmount();
  });

  it('asks for the key with a link to get one', async () => {
    const { app, frame } = mount({ model: undefined });
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(frame()).toContain('Paste your API key');
    expect(frame()).toContain('Get one at platform.openai.com/api-keys');
    app.unmount();
  });

  it('closes the panel on Esc and leaves a way back', async () => {
    const { app, frame, chat } = mount({ model: undefined });
    await tick();
    app.stdin.write('\x1b');
    await until(() => !chat.getState().overlay);
    await tick();
    expect(frame()).toContain('/login connect a model');
    app.unmount();
  });
});

describe('slash autocomplete', () => {
  it('lists commands with descriptions as soon as / is typed', async () => {
    const { app, frame } = mount();
    app.stdin.write('/');
    await tick();
    expect(frame()).toContain('/model');
    expect(frame()).toContain('Switch the model');
    expect(frame()).toContain('Tab complete');
    app.unmount();
  });

  it('narrows as you type and completes with Tab', async () => {
    const { app, frame } = mount();
    app.stdin.write('/ses');
    await tick();
    expect(frame()).toContain('Pick up an unfinished task');
    expect(frame()).not.toContain('Switch the model');
    app.stdin.write('\t');
    await tick();
    expect(frame()).toContain('/sessions');
    app.unmount();
  });

  it('runs the highlighted command on Enter, with arrows to move', async () => {
    const { app, chat } = mount();
    app.stdin.write('/');
    await tick();
    app.stdin.write('\x1b[B'); // down: second row is /login
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().overlay === 'login');
    expect(chat.getState().overlay).toBe('login');
    app.unmount();
  });

  it('stays out of the way for ordinary text', async () => {
    const { app, frame } = mount();
    app.stdin.write('hello /model');
    await tick();
    expect(frame()).not.toContain('Switch the model');
    app.unmount();
  });
});

describe('command palette', () => {
  it('opens with Ctrl+P, filters, and runs a command', async () => {
    const { app, frame, chat } = mount();
    app.stdin.write('\x10');
    await tick();
    expect(frame()).toContain('Commands');
    expect(frame()).toContain('Switch the model');
    expect(frame()).toContain('Read the whole conversation');
    app.stdin.write('conn');
    await tick();
    expect(frame()).toContain('Connect a provider or replace a key');
    expect(frame()).not.toContain('Start a fresh conversation');
    app.stdin.write('\r');
    await until(() => chat.getState().overlay === 'login');
    expect(chat.getState().overlay).toBe('login');
    app.unmount();
  });

  it('closes with Esc and the prompt comes back', async () => {
    const { app, chat } = mount();
    app.stdin.write('\x10');
    await tick();
    app.stdin.write('\x1b');
    await until(() => !chat.getState().overlay);
    expect(chat.getState().overlay).toBeUndefined();
    app.unmount();
  });
});

describe('/model', () => {
  it('lists models with prices, marks the one in use and switches on Enter', async () => {
    const { app, frame, chat } = mount();
    app.stdin.write('/model');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().overlay === 'model');
    await tick();
    expect(frame()).toContain('Switch model');
    expect(frame()).toContain('gpt-4o');
    expect(frame()).toContain('$2.5 in, $10 out per M');
    expect(frame()).toContain('in use');
    app.stdin.write('4o');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().model === 'gpt-4o');
    expect(chat.getState().model).toBe('gpt-4o');
    await tick();
    expect(frame()).toContain('gpt-4o');
    app.unmount();
  });

  it('offers to use a model id that is not in the list', async () => {
    const { app, frame, chat } = mount();
    app.stdin.write('/model');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().overlay === 'model');
    app.stdin.write('my-tuned-model');
    await tick();
    expect(frame()).toContain('Use "my-tuned-model"');
    app.stdin.write('\r');
    await until(() => chat.getState().model === 'my-tuned-model');
    expect(chat.getState().model).toBe('my-tuned-model');
    app.unmount();
  });
});

describe('@ files', () => {
  it('lists workspace files after @ and completes one with Tab', async () => {
    const { app, frame } = mount();
    app.stdin.write('read @');
    await tick(80);
    expect(frame()).toContain('src/');
    expect(frame()).toContain('notes.txt');
    expect(frame()).toContain('attach');
    app.stdin.write('\x1b[B');
    await tick();
    app.stdin.write('\t');
    await tick();
    expect(frame()).toContain('@notes.txt');
    app.unmount();
  });

  it('does not send the message when Enter picks a file', async () => {
    const { app, chat } = mount();
    app.stdin.write('read @no');
    await tick(80);
    app.stdin.write('\r');
    await tick();
    expect(chat.history()).toEqual([]);
    app.unmount();
  });
});

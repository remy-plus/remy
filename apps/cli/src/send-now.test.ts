// Send now: a message that stops the running turn and goes in its place, from the keys down.
import { createRuntime, DEFAULT_BUDGET, type ModelClient, ToolRegistry } from '@remy/core';
import { DEFAULT_CAPS } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { type Chat, createChat, releaseLease } from './chat.ts';
import { ChatApp, hintsFor } from './chat-ui.ts';
import { createTheme } from './theme.ts';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};
const usage = { inTokens: 10, outTokens: 5 };

/** A model whose first call never returns; later calls finish at once. */
function setup(): { chat: Chat } {
  let n = 0;
  const model: ModelClient = {
    id: 'slow',
    caps: DEFAULT_CAPS,
    complete: () => {
      if (n++ === 0) return new Promise(() => {});
      return Promise.resolve({
        calls: [{ tool: 'finish', args: { answer: `Answer ${n}.` } }],
        usage,
      });
    },
  };
  const store = new MemoryEventStore();
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'send-now',
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
    release: releaseLease(store, 'send-now'),
    model: 'slow',
  });
  return { chat };
}

const users = (chat: Chat) =>
  chat.getState().items.flatMap((i) => (i.kind === 'user' ? [i.text] : []));
const replies = (chat: Chat) =>
  chat.getState().items.flatMap((i) => (i.kind === 'reply' ? [i.text] : []));

describe('send now', () => {
  it('stops the running turn, sends the message, and keeps the queue behind it', async () => {
    const { chat } = setup();
    void chat.submit('first');
    await until(() => chat.getState().phase === 'running');
    await chat.submit('queued');
    await tick(); // let the task get an id
    void chat.sendNow('urgent');
    await until(() => replies(chat).length >= 2);
    const s = chat.getState();
    expect(users(chat)).toEqual(['first', 'urgent', 'queued']);
    expect(JSON.stringify(s.items)).toContain('Stopped to send your message');
    expect(JSON.stringify(s.items)).not.toContain('dropped');
    expect(s.queue).toEqual([]);
  });

  it('is a plain send when nothing is running', async () => {
    const { chat } = setup();
    void chat.sendNow('hello');
    await until(() => users(chat).length === 1);
    expect(users(chat)).toEqual(['hello']);
  });
});

describe('send now keys', () => {
  for (const [name, keys] of [
    ['Ctrl+S', '\x13'],
    ['Alt+Enter', '\x1b\r'],
  ] as const) {
    it(`${name} sends the typed message now; Enter still queues`, async () => {
      const { chat } = setup();
      const app = render(
        h(ChatApp, { chat, theme: createTheme('none'), reducedMotion: true, minimal: true }),
      );
      await tick();
      app.stdin.write('first');
      await tick();
      app.stdin.write('\r');
      await until(() => chat.getState().phase === 'running');
      app.stdin.write('later');
      await tick();
      app.stdin.write('\r');
      await until(() => chat.getState().queue.length === 1);
      expect(chat.getState().queue).toEqual(['later']);
      app.stdin.write('now');
      await tick();
      app.stdin.write(keys);
      await until(() => users(chat).includes('now'));
      expect(users(chat)).toEqual(['first', 'now', 'later']);
      app.unmount();
    });
  }

  it('Ctrl+S with nothing typed does nothing', async () => {
    const { chat } = setup();
    const app = render(
      h(ChatApp, { chat, theme: createTheme('none'), reducedMotion: true, minimal: true }),
    );
    await tick();
    app.stdin.write('first');
    await tick();
    app.stdin.write('\r');
    await until(() => chat.getState().phase === 'running');
    app.stdin.write('\x13');
    await tick(80);
    expect(chat.getState().phase).toBe('running');
    expect(users(chat)).toEqual(['first']);
    app.unmount();
  });
});

describe('send now hint', () => {
  it('shows only while running with something typed', () => {
    expect(hintsFor('running', true)).toBe('Enter queue · Ctrl+S send now · Ctrl+C stop');
    expect(hintsFor('running', false)).toBe('Enter queue · Ctrl+C stop');
    expect(hintsFor('idle', true)).not.toContain('send now');
  });
});

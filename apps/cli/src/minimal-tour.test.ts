// The tour in the minimal screen: the same steps as plain left-aligned text in the flow of the terminal.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { ChatApp } from './chat-ui.ts';
import { createOnboarding } from './onboarding-flow.ts';
import { createProfileStore } from './profile.ts';
import { createTheme } from './theme.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-mtour-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

function mount() {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient([
    {
      calls: [{ tool: 'finish', args: { answer: 'Here is the quiz.' } }],
      usage: { inTokens: 1, outTokens: 1 },
    },
  ]);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'mtour',
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
      workspaceDir: dir,
      context,
    }),
    release: releaseLease(store, 'mtour'),
    model: 'gpt-5-nano',
    connect: {
      providers: () => [],
      models: () => [{ provider: 'openai', model: 'gpt-5-nano', detail: 'cheap' }],
      login: async () => ({ ok: false as const, message: 'no' }),
      use: async (_p, m) => ({ ok: true, message: 'Now using it.', model: m }),
    },
  });
  const profile = createProfileStore(dir);
  const onboarding = createOnboarding({
    chat,
    profile,
    markDone: () => {},
    scratchDir: () => join(dir, 's'),
  });
  onboarding.start();
  const app = render(
    h(ChatApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'gpt-5-nano',
      minimal: true,
      approvalSettleMs: 0,
      profile,
      onboarding,
    }),
  );
  return { app, profile, onboarding, frame: () => app.lastFrame() ?? '' };
}

describe('minimal tour', () => {
  it('asks the same questions in plain text and hands the screen back', async () => {
    const t = mount();
    const key = async (s: string, ms = 50) => {
      t.app.stdin.write(s);
      await tick(ms);
    };
    await tick();
    expect(t.frame()).toContain('Enter to begin');
    expect(t.frame()).not.toContain(':::');
    expect(t.frame()).not.toContain('Ask anything');
    await key('\r');
    await key('Ana');
    await key('\r');
    expect(t.frame()).toContain('What do you mostly want help with?');
    for (let i = 0; i < 4; i++) await key('\x1b[B');
    await key(' ');
    await key('\r');
    await key('n', 100);
    expect(t.frame()).toContain('Pick a model');
    await key('\r', 100);
    expect(t.frame()).toContain('Make a 5-question quiz on photosynthesis');
    await key('\r');
    await until(() => t.frame().includes('Here is the quiz.'));
    expect(t.frame()).toContain('Enter to continue');
    await key('\r');
    expect(t.frame()).toContain('Three keys to remember');
    await key('\r', 100);
    expect(t.frame()).not.toContain('Three keys');
    expect(t.profile.get()).toMatchObject({ name: 'Ana', goals: ['school'], personalise: false });
    t.app.unmount();
  });

  it('Esc skips it all', async () => {
    const t = mount();
    await tick();
    t.app.stdin.write('\x1b');
    await tick(100);
    expect(t.onboarding.getState()).toBeUndefined();
    expect(t.frame()).not.toContain('Enter to begin');
    t.app.unmount();
  });
});

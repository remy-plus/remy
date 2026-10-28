import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish, writeFile } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChat, releaseLease } from '../chat.ts';
import { createOnboarding } from '../onboarding-flow.ts';
import { createProfileStore } from '../profile.ts';
import { createTheme } from '../theme.ts';
import { FullApp } from './full-app.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-tour-app-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

async function tourApp(size: [number, number]) {
  const profile = createProfileStore(dir);
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient([
    {
      calls: [{ tool: 'finish', args: { answer: 'Here are three apps.' } }],
      usage: { inTokens: 1, outTokens: 1 },
    },
  ]);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([writeFile, finish]),
        owner: 'tour-test',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        ...hooks,
      }),
    config: (context) => ({
      model: model.id,
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: dir,
      context,
    }),
    release: releaseLease(store, 'tour-test'),
    model: 'test-model',
    newClears: true,
    connect: {
      providers: () => [],
      models: () => [{ provider: 'openai', model: 'test-model', detail: 'cheap' }],
      login: async () => ({ ok: false as const, message: 'no' }),
      use: async (_p, m) => ({ ok: true, message: 'Now using it.', model: m }),
    },
  });
  const onboarding = createOnboarding({
    chat,
    profile,
    markDone: () => {},
    scratchDir: () => join(dir, 'scratch'),
  });
  onboarding.start();
  const app = render(
    h(FullApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'test-model',
      workspace: '/work/proj',
      approvalSettleMs: 0,
      version: '1.2.3',
      profile,
      onboarding,
    }),
  );
  Object.defineProperty(app.stdout, 'columns', { value: size[0], configurable: true });
  Object.defineProperty(app.stdout, 'rows', { value: size[1], configurable: true });
  app.stdout.emit('resize');
  await tick();
  return { app, chat, profile, frame: () => app.lastFrame() ?? '' };
}

describe('FullApp tour', () => {
  for (const size of [
    [100, 30],
    [80, 24],
  ] as [number, number][]) {
    it(`walks the whole tour at ${size.join('x')} and lands on a greeting`, async () => {
      const t = await tourApp(size);
      const fits = () => expect(t.frame().split('\n').length).toBeLessThanOrEqual(size[1]);
      const key = async (s: string, ms = 40) => {
        t.app.stdin.write(s);
        await tick(ms);
      };
      expect(t.frame()).toContain('Enter to begin');
      fits();
      await key('\r');
      expect(t.frame()).toContain('What should I call you?');
      await key('Sam');
      await key('\r');
      expect(t.frame()).toContain('What do you mostly want help with?');
      fits();
      await key('\x1b[B');
      await key(' ');
      await key('\r');
      expect(t.frame()).toContain('Use this to personalise replies?');
      await key('y', 80);
      expect(t.frame()).toContain('Pick a model');
      await key('\r', 100);
      expect(t.frame()).toContain('Ready for a first task?');
      expect(t.frame()).toContain('note-taking apps');
      await key('\r');
      await until(() => t.frame().includes('Here are three apps.'));
      expect(t.frame()).toContain('Here are three apps.');
      expect(t.frame()).toContain('Enter to continue');
      fits();
      await key('\r');
      expect(t.frame()).toContain('Three keys to remember');
      await key('\r', 100);
      expect(t.frame()).toMatch(/Good (morning|afternoon|evening), Sam\./);
      expect(t.frame()).not.toContain('three apps');
      expect(t.profile.get()).toMatchObject({
        name: 'Sam',
        goals: ['research'],
        personalise: true,
      });
      t.app.unmount();
    });
  }

  it('Esc skips everything and typing never reaches the hidden prompt', async () => {
    const t = await tourApp([100, 30]);
    t.app.stdin.write('abc');
    await tick();
    t.app.stdin.write('\x1b');
    await tick(100);
    expect(t.frame()).toContain('Ask anything…');
    expect(t.frame()).not.toContain('Enter to begin');
    expect(t.frame()).not.toContain('abc');
    expect(t.chat.getState().items).toHaveLength(0);
    t.app.unmount();
  });
});

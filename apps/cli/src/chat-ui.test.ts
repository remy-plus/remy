import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, DEFAULT_BUDGET, type ModelResponse, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish, writeFile } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { ChatApp } from './chat-ui.ts';
import { createTheme } from './theme.ts';

const usage = { inTokens: 10, outTokens: 5 };
const call = (tool: string, args: unknown): ModelResponse => ({ calls: [{ tool, args }], usage });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-ui-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function mount(steps: ModelResponse[], autoApprove: ('read' | 'write')[] = ['read']) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(steps);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([writeFile, finish]),
        owner: 'ui-test',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        ...hooks,
      }),
    config: (context) => ({
      model: model.id,
      permissions: { autoApprove },
      budget: DEFAULT_BUDGET,
      workspaceDir: dir,
      context,
    }),
    release: releaseLease(store, 'ui-test'),
  });
  const app = render(
    h(ChatApp, { chat, theme: createTheme('none'), reducedMotion: true, subtitle: 'test-model' }),
  );
  return { chat, ...app };
}
type Mounted = ReturnType<typeof mount>;

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};
const frame = (app: Mounted) => app.lastFrame() ?? '';
const type = async (app: Mounted, text: string) => {
  app.stdin.write(text);
  await new Promise((r) => setTimeout(r, 20));
  app.stdin.write('\r');
};

describe('chat screen', () => {
  it('shows the wordmark, takes a message and prints the reply', async () => {
    const app = mount([call('finish', { answer: 'Four.' })]);
    expect(frame(app)).toContain(':::::::..');
    expect(frame(app)).toContain('Real work, quietly done.');
    await type(app, 'what is 2+2');
    await until(() => app.chat.getState().items.some((i) => i.kind === 'reply'));
    expect(frame(app)).toContain('what is 2+2');
    expect(frame(app)).toContain('Four.');
    app.unmount();
  });

  it('asks for approval inline and runs the tool after y', async () => {
    const app = mount([
      call('write_file', { path: 'a.txt', content: 'x' }),
      call('finish', { answer: 'Wrote a.txt.' }),
    ]);
    await type(app, 'write a file');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    expect(frame(app)).toContain('Approval needed');
    expect(frame(app)).toContain('write_file');
    expect(frame(app)).toContain('[y/n]');
    app.stdin.write('y');
    await until(() => app.chat.getState().phase === 'idle');
    expect(frame(app)).toContain('Wrote a.txt.');
    app.unmount();
  });

  it('Esc clears the input and Up brings back the last message', async () => {
    const app = mount([call('finish', { answer: 'Ok.' })]);
    app.stdin.write('draft');
    await until(() => frame(app).includes('draft'));
    app.stdin.write('\x1b');
    await until(() => !frame(app).includes('draft'));
    expect(frame(app)).not.toContain('draft');
    await type(app, 'first');
    await until(() => app.chat.getState().phase === 'idle' && app.chat.history().length === 1);
    app.stdin.write('\x1b[A');
    await until(() => frame(app).split('first').length > 2);
    expect(frame(app).split('first').length).toBeGreaterThan(2);
    app.unmount();
  });
});

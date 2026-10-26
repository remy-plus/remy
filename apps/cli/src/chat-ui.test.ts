import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntime,
  DEFAULT_BUDGET,
  type ModelClient,
  type ModelResponse,
  ToolRegistry,
} from '@remy/core';
import { DEFAULT_CAPS, ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish, writeFile } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { ChatApp, contextPart, costPart } from './chat-ui.ts';
import { createTheme } from './theme.ts';

const usage = { inTokens: 10, outTokens: 5 };
const call = (tool: string, args: unknown, text?: string): ModelResponse => ({
  calls: [{ tool, args }],
  usage,
  ...(text && { text }),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-ui-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function mount(model: ModelClient, autoApprove: ('read' | 'write')[] = ['read']) {
  const store = new MemoryEventStore();
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
const scripted = (steps: ModelResponse[], auto?: ('read' | 'write')[]) =>
  mount(new ScriptedModelClient(steps), auto);
type Mounted = ReturnType<typeof mount>;

const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
};
const frame = (app: Mounted) => app.lastFrame() ?? '';
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const type = async (app: Mounted, text: string) => {
  app.stdin.write(text);
  await new Promise((r) => setTimeout(r, 20));
  app.stdin.write('\r');
};

describe('chat screen', () => {
  it('shows the wordmark, takes a message and prints the reply', async () => {
    const app = scripted([call('finish', { answer: 'Four.' })]);
    expect(frame(app)).toContain(':::::::..');
    expect(frame(app)).toContain('Your assistant, anywhere.');
    expect(frame(app)).toContain('test-model');
    await type(app, 'what is 2+2');
    await until(() => app.chat.getState().items.some((i) => i.kind === 'reply'));
    expect(frame(app)).toContain('what is 2+2');
    expect(frame(app)).toContain('Four.');
    app.unmount();
  });

  it('prints a user message and a reply once, not once per frame', async () => {
    const app = scripted([call('finish', { answer: 'Four, exactly.' })]);
    await type(app, 'what is 2+2');
    await until(() => app.chat.getState().phase === 'idle' && app.chat.history().length === 1);
    await new Promise((r) => setTimeout(r, 50));
    // In test mode Ink writes the whole screen each frame, so count in the last one.
    expect(count(frame(app), '› what is 2+2')).toBe(1);
    expect(app.chat.getState().items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(count(frame(app), 'Four, exactly.')).toBe(1);
    app.unmount();
  });

  it('commits a long streamed reply once, however many chunks it came in', async () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const narration = words.join(' ');
    let n = 0;
    const model: ModelClient = {
      id: 'chunky',
      caps: DEFAULT_CAPS,
      complete: async (_req, _signal, onText) => {
        if (n++ === 0) {
          for (const w of words) {
            onText?.(`${w} `);
            await new Promise((r) => setTimeout(r, 2));
          }
          return call('write_file', { path: 'a.txt', content: 'x' }, narration);
        }
        return call('finish', { answer: 'All done.' });
      },
    };
    const app = mount(model, ['read', 'write']);
    await type(app, 'go');
    await until(() => app.chat.getState().phase === 'idle' && n >= 2);
    await new Promise((r) => setTimeout(r, 60));
    const state = app.chat.getState();
    expect(state.items.filter((i) => i.kind === 'text')).toHaveLength(1);
    expect(state.streaming).toBe('');
    // The final screen holds the text once and the live area is empty of it.
    expect(count(frame(app), 'word39')).toBe(1);
    expect(count(frame(app), 'All done.')).toBe(1);
    expect(count(frame(app), '› go')).toBe(1);
    app.unmount();
  });

  it('queues Enter while a task runs and runs it after, in order', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let n = 0;
    const model: ModelClient = {
      id: 'slow',
      caps: DEFAULT_CAPS,
      complete: async () => {
        n++;
        if (n === 1) await gate;
        return call('finish', { answer: n === 1 ? 'First answer.' : 'Second answer.' });
      },
    };
    const app = mount(model);
    await type(app, 'first');
    await until(() => app.chat.getState().phase === 'running');
    await type(app, 'second');
    await until(() => app.chat.getState().queue.length === 1);
    expect(app.chat.getState().queue).toEqual(['second']);
    await until(() => frame(app).includes('second  queued'));
    expect(frame(app)).toContain('second  queued');
    // Not committed yet, and not started.
    expect(app.chat.getState().items.filter((i) => i.kind === 'user')).toHaveLength(1);
    release();
    await until(() => app.chat.getState().items.filter((i) => i.kind === 'reply').length === 2);
    const items = app.chat.getState().items;
    expect(items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text)).toEqual(
      ['first', 'second'],
    );
    expect(app.chat.getState().queue).toEqual([]);
    expect(count(frame(app), '› second')).toBe(1);
    app.unmount();
  });

  it('shows no plan until it has steps, then shows it once in the live area', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let n = 0;
    const model: ModelClient = {
      id: 'planner',
      caps: DEFAULT_CAPS,
      complete: async () => {
        if (n++ === 0)
          return call('update_plan', {
            steps: [
              { text: 'Read the notes', status: 'doing' },
              { text: 'Write summary', status: 'pending' },
            ],
          });
        await gate;
        return call('finish', { answer: 'Done here.' });
      },
    };
    const app = mount(model);
    await type(app, 'plan it');
    await until(() => app.chat.getState().phase === 'running' && frame(app).includes('Thinking'));
    expect(frame(app)).not.toContain('Plan');
    await until(() => (app.chat.getState().plan?.length ?? 0) === 2);
    await until(() => frame(app).includes('Plan 0/2'));
    expect(count(frame(app), 'Plan 0/2')).toBe(1);
    expect(frame(app)).toContain('Read the notes');
    release();
    await until(() => app.chat.getState().phase === 'idle');
    // Unfinished plans are kept once in the transcript.
    expect(app.chat.getState().items.filter((i) => i.kind === 'plan')).toHaveLength(1);
    app.unmount();
  });

  it('asks for approval inline and runs the tool after y', async () => {
    const app = scripted([
      call('write_file', { path: 'a.txt', content: 'x' }),
      call('finish', { answer: 'Wrote a.txt.' }),
    ]);
    await type(app, 'write a file');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    expect(frame(app)).toContain('Write a.txt');
    expect(frame(app)).toContain('Risk: write');
    expect(frame(app)).toContain('y approve');
    app.stdin.write('y');
    await until(() => app.chat.getState().phase === 'idle');
    expect(frame(app)).toContain('Wrote a.txt.');
    expect(frame(app)).toContain('write a.txt');
    app.unmount();
  });

  it('narrates on one row, with no duplicate lines, and shows the footer meters', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let n = 0;
    const model: ModelClient = {
      id: 'narrator',
      caps: DEFAULT_CAPS,
      complete: async () => {
        if (n++ === 0) await gate;
        return call('finish', { answer: 'Fine.' });
      },
    };
    const app = mount(model);
    await type(app, 'hello');
    await until(() => frame(app).includes('Thinking'));
    expect(count(frame(app), 'Thinking')).toBe(1);
    expect(frame(app)).toContain('$0 of $1.00');
    release();
    await until(() => app.chat.getState().phase === 'idle');
    expect(frame(app)).not.toContain('Thinking');
    app.unmount();
  });

  it('Esc clears the input and Up brings back the last message', async () => {
    const app = scripted([call('finish', { answer: 'Ok.' })]);
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

describe('footer meters', () => {
  it('shows context only when the window is known', () => {
    expect(contextPart({ contextTokens: 14000, contextWindow: 100000 })).toBe('14% context');
    expect(contextPart({ contextTokens: 14000, contextWindow: undefined })).toBe('');
    expect(contextPart({ contextTokens: 0, contextWindow: 100000 })).toBe('');
    expect(contextPart({ contextTokens: 500000, contextWindow: 100000 })).toBe('100% context');
  });
  it('shows task spend against its budget', () => {
    expect(costPart({ taskCostUsd: 0.04, budgetUsd: 0.5 })).toBe('$0.04 of $0.50');
    expect(costPart({ taskCostUsd: 0.0004, budgetUsd: 1 })).toBe('<$0.01 of $1.00');
    expect(costPart({ taskCostUsd: 0, budgetUsd: undefined })).toBe('');
  });
});

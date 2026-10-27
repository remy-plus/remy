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
import { createScopedFetch, createScopedFs, deleteFile, finish, writeFile } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';
import { ChatApp, contextPart, costPart, promptRows } from './chat-ui.ts';
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

function mount(
  model: ModelClient,
  autoApprove: ('read' | 'write')[] = ['read'],
  settle = 0,
  inputMode?: 'single' | 'multi',
) {
  const store = new MemoryEventStore();
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([writeFile, deleteFile, finish]),
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
    h(ChatApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'test-model',
      approvalSettleMs: settle,
      inputMode,
    }),
  );
  return { chat, ...app };
}
const scripted = (steps: ModelResponse[], auto?: ('read' | 'write')[], settle?: number) =>
  mount(new ScriptedModelClient(steps), auto, settle);
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
    expect(frame(app)).toMatch(/write\s+a\.txt/);
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

  const askToDelete = (settle?: number) =>
    scripted(
      [call('delete_file', { path: 'a.txt' }), call('finish', { answer: 'Left a.txt alone.' })],
      undefined,
      settle,
    );

  it('shows the approval card with the short hash, reversibility and the three keys', async () => {
    const app = askToDelete();
    await type(app, 'delete it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    const view = app.chat.getState().approvalView;
    expect(view?.shortHash).toHaveLength(6);
    const f = frame(app);
    expect(f).toContain('Delete a.txt');
    expect(f).toContain(`Approval covers exactly this call (${view?.shortHash}).`);
    expect(f).toContain('cannot be undone');
    expect(f).toContain('y approve once');
    expect(f).toContain('n deny');
    expect(f).toContain('e deny and say why');
    expect(count(f, 'Delete a.txt')).toBe(1);
    app.unmount();
  });

  it('Enter and other keys never approve', async () => {
    const app = askToDelete();
    await type(app, 'delete it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    for (const k of ['\r', ' ', 'x', 'yes', '\x1b']) {
      app.stdin.write(k);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(app.chat.getState().phase).toBe('waiting_approval');
    app.unmount();
  });

  it('ignores approval keys typed in the first moment a card is up', async () => {
    const app = askToDelete(200);
    await type(app, 'delete it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    app.stdin.write('y');
    await new Promise((r) => setTimeout(r, 40));
    expect(app.chat.getState().phase).toBe('waiting_approval');
    await new Promise((r) => setTimeout(r, 220));
    app.stdin.write('n');
    await until(() => app.chat.getState().phase === 'idle');
    expect(frame(app)).toContain('you said no');
    app.unmount();
  });

  it('n denies without a note', async () => {
    const app = askToDelete();
    await type(app, 'delete it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    app.stdin.write('n');
    await until(() => app.chat.getState().phase === 'idle');
    expect(frame(app)).toContain('Left a.txt alone.');
    expect(frame(app)).toContain('you said no');
    app.unmount();
  });

  it('e takes a note, Enter sends it as a denial, and the model reads it', async () => {
    const seen: string[] = [];
    let n = 0;
    const model: ModelClient = {
      id: 'noted',
      caps: DEFAULT_CAPS,
      complete: async (req) => {
        seen.push(JSON.stringify(req.messages));
        return n++ === 0
          ? call('delete_file', { path: 'a.txt' })
          : call('finish', { answer: 'Kept it.' });
      },
    };
    const app = mount(model);
    await type(app, 'delete it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    app.stdin.write('e');
    await until(() => frame(app).includes('Say why below'));
    // An empty note does nothing.
    app.stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(app.chat.getState().phase).toBe('waiting_approval');
    await type(app, 'keep it, I need it');
    await until(() => app.chat.getState().phase === 'idle');
    expect(seen[1]).toContain('declined this action and said: keep it, I need it');
    expect(frame(app)).toContain('Kept it.');
    expect(frame(app)).toContain('you said: keep it, I need it');
    app.unmount();
  });

  it('Esc leaves the note without answering; v shows every row', async () => {
    const content = Array.from({ length: 12 }, (_, i) => `row${i}`).join('\n');
    const app = scripted([call('write_file', { path: 'a.txt', content }), call('finish', {})], []);
    await type(app, 'write it');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    expect(frame(app)).toContain('row3');
    expect(frame(app)).not.toContain('row11');
    expect(frame(app)).toContain('v shows all');
    app.stdin.write('v');
    await until(() => frame(app).includes('row11'));
    app.stdin.write('v');
    await until(() => !frame(app).includes('row11'));
    app.stdin.write('e');
    await until(() => frame(app).includes('Say why below'));
    app.stdin.write('\x1b');
    await until(() => frame(app).includes('y approve once'));
    expect(app.chat.getState().phase).toBe('waiting_approval');
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

describe('multi-line input and paste', () => {
  const say = (text: string) => [call('finish', { answer: text })];
  const pause = () => new Promise((r) => setTimeout(r, 30));
  const bigPaste = Array.from({ length: 9 }, (_, i) => `pasted row ${i}`).join('\n');

  it('Ctrl+J and backslash then Enter add lines; Enter sends them together', async () => {
    const app = scripted(say('ok'));
    app.stdin.write('first');
    await pause();
    app.stdin.write('\n');
    await pause();
    app.stdin.write('second\\');
    await pause();
    app.stdin.write('\r');
    await pause();
    app.stdin.write('third');
    await pause();
    expect(frame(app)).toContain('first');
    expect(frame(app)).toContain('second');
    expect(app.chat.history()).toHaveLength(0);
    app.stdin.write('\r');
    await until(() => app.chat.history().length === 1);
    expect(app.chat.history()[0]).toBe('first\nsecond\nthird');
    app.unmount();
  });

  it('shows a big bracketed paste as a marker and sends the real text', async () => {
    const app = scripted(say('ok'));
    app.stdin.write(`\x1b[200~${bigPaste}\x1b[201~`);
    await pause();
    expect(frame(app)).toContain('[Pasted 9 lines]');
    expect(frame(app)).not.toContain('pasted row 3');
    app.stdin.write('\r');
    await until(() => app.chat.history().length === 1);
    expect(app.chat.history()[0]).toBe(bigPaste);
    await until(() => app.chat.getState().phase === 'idle');
    // The scrollback shows the head of it; Ctrl+O has the rest.
    expect(frame(app)).toContain('5 more lines');
    expect(frame(app)).not.toContain('pasted row 7');
    app.unmount();
  });

  it('counts a row per line, and at most a window of them', () => {
    expect(promptRows('one', 80)).toBe(1);
    expect(promptRows('one\ntwo\nthree', 80)).toBe(3);
    expect(promptRows(Array(20).fill('x').join('\n'), 80)).toBe(6);
    expect(promptRows('x'.repeat(170), 80)).toBe(3);
  });

  it('a paste cannot answer an approval card', async () => {
    const app = scripted(
      [call('write_file', { path: 'a.txt', content: 'x' }), call('finish', { answer: 'ok' })],
      ['read'],
    );
    await type(app, 'save');
    await until(() => app.chat.getState().phase === 'waiting_approval');
    app.stdin.write('\x1b[200~y\x1b[201~');
    await pause();
    expect(app.chat.getState().phase).toBe('waiting_approval');
    app.unmount();
  });

  it('REMY_INPUT=single keeps the old editor: newlines flatten, pastes stay inline', async () => {
    const app = mount(new ScriptedModelClient(say('ok')), ['read'], 0, 'single');
    app.stdin.write('a');
    await pause();
    app.stdin.write('\n');
    await pause();
    app.stdin.write('b');
    await pause();
    app.stdin.write('\r');
    await until(() => app.chat.history().length === 1);
    expect(app.chat.history()[0]).toBe('a b');
    app.unmount();
  });
});

describe('full transcript view', () => {
  it('Ctrl+O opens it over the prompt, q goes back', async () => {
    const app = scripted(
      [call('write_file', { path: 'a.txt', content: 'x' }), call('finish', { answer: 'Saved.' })],
      ['read', 'write'],
    );
    await type(app, 'save a file');
    await until(() => app.chat.getState().phase === 'idle' && app.chat.history().length === 1);
    app.stdin.write('\x0f');
    await until(() => frame(app).includes('q back'));
    expect(frame(app)).toContain('j/k scroll');
    expect(frame(app)).toContain('Saved.');
    expect(frame(app)).not.toContain('/ commands');
    app.stdin.write('q');
    await until(() => !frame(app).includes('q back'));
    expect(frame(app)).toContain('/ commands');
    app.unmount();
  });
});

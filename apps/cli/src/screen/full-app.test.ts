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
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, deleteFile, finish, writeFile } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChatDeps, createChat, releaseLease } from '../chat.ts';
import { createTheme } from '../theme.ts';
import { FullApp } from './full-app.ts';

const usage = { inTokens: 10, outTokens: 5 };
const call = (tool: string, args: unknown, text?: string): ModelResponse => ({
  calls: [{ tool, args }],
  usage,
  ...(text && { text }),
});
const done = (answer: string) => call('finish', { answer });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-full-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await tick(10);
};

function mount(
  model: ModelClient,
  opts: { auto?: ('read' | 'write')[]; size?: [number, number]; deps?: Partial<ChatDeps> } = {},
) {
  const store = new MemoryEventStore();
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([writeFile, deleteFile, finish]),
        owner: 'full-test',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        ...hooks,
      }),
    config: (context) => ({
      model: model.id,
      permissions: { autoApprove: opts.auto ?? ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: dir,
      context,
    }),
    release: releaseLease(store, 'full-test'),
    model: 'test-model',
    ...opts.deps,
  });
  const app = render(
    h(FullApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'test-model',
      workspace: '/work/proj',
      approvalSettleMs: 0,
      version: '1.2.3',
    }),
  );
  const resize = async (cols: number, rows: number) => {
    Object.defineProperty(app.stdout, 'columns', { value: cols, configurable: true });
    Object.defineProperty(app.stdout, 'rows', { value: rows, configurable: true });
    app.stdout.emit('resize');
    await tick();
  };
  const frame = () => app.lastFrame() ?? '';
  const send = async (text: string) => {
    app.stdin.write(text);
    await tick(20);
    app.stdin.write('\r');
    await tick();
  };
  return { chat, app, resize, frame, send, size: opts.size ?? [100, 30] };
}

async function open(model: ModelClient, opts: Parameters<typeof mount>[1] = {}) {
  const m = mount(model, opts);
  await m.resize(...m.size);
  return m;
}

describe('FullApp', () => {
  it('opens on the home screen at 100x30 with the prompt, a tip and the footer', async () => {
    const m = await open(new ScriptedModelClient([]));
    const f = m.frame();
    expect(f.split('\n').length).toBeLessThanOrEqual(30);
    expect(f).toContain('Ask anything…');
    expect(f).toContain('test-model');
    expect(f).toContain('Tip ');
    expect(f).toContain('/work/proj');
    expect(f).toContain('v1.2.3');
    // Centred: the prompt is not on the last rows.
    expect(f.split('\n').findIndex((l) => l.includes('Ask anything…'))).toBeLessThan(20);
    m.app.unmount();
  });

  it('fits an 80x24 terminal', async () => {
    const m = await open(new ScriptedModelClient([]), { size: [80, 24] });
    expect(m.frame().split('\n').length).toBeLessThanOrEqual(24);
    expect(m.frame()).toContain('Ask anything…');
    expect(m.frame()).toContain('v1.2.3');
    m.app.unmount();
  });

  it('leaves home on the first message and returns on /clear and /new', async () => {
    const m = await open(new ScriptedModelClient([done('Four.')]));
    await m.send('what is 2+2');
    await until(() => m.chat.getState().items.some((i) => i.kind === 'reply'));
    await tick();
    expect(m.frame()).not.toContain('Tip ');
    expect(m.frame()).toContain('ctrl+p commands');
    await m.send('/clear');
    await tick();
    expect(m.frame()).toContain('Tip ');
    expect(m.frame()).not.toContain('Four.');
    m.app.unmount();
  });

  it('shows a message in a bar and the reply with its model footer', async () => {
    const m = await open(new ScriptedModelClient([done('Four.')]));
    await m.send('what is 2+2');
    await until(() => m.chat.getState().items.some((i) => i.kind === 'reply'));
    await tick();
    expect(m.frame()).toContain('┃  what is 2+2');
    expect(m.frame()).toContain('   Four.');
    expect(m.frame()).toMatch(/▣ test-model · \d+s/);
    m.app.unmount();
  });

  it('shows tool rows inline with a glyph', async () => {
    const m = await open(
      new ScriptedModelClient([
        call('write_file', { path: 'notes.txt', content: 'hi' }, 'Writing it.'),
        done('Saved.'),
      ]),
      { auto: ['read', 'write'] },
    );
    await m.send('save a note');
    await until(() => m.chat.getState().items.some((i) => i.kind === 'reply'));
    await tick();
    expect(m.frame()).toContain('Writing it.');
    expect(m.frame()).toContain('← write notes.txt');
    m.app.unmount();
  });

  it('puts the approval card in the bottom slot in place of the prompt', async () => {
    const m = await open(
      new ScriptedModelClient([call('write_file', { path: 'a.txt', content: 'x' }), done('ok')]),
      { auto: ['read'] },
    );
    await m.send('write a file');
    await until(() => m.chat.getState().phase === 'waiting_approval');
    await tick();
    const f = m.frame();
    expect(f).toContain('y');
    expect(f).toContain('approve once');
    expect(f).not.toContain('Ask anything…');
    expect(f.split('\n').length).toBeLessThanOrEqual(30);
    m.app.stdin.write('y');
    await until(() => m.chat.getState().phase === 'idle');
    m.app.unmount();
  });

  it('keeps its place when the user has scrolled up and new content arrives', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = new ScriptedModelClient([
      done(Array.from({ length: 20 }, (_, i) => `first line ${i}`).join('\n\n')),
      done('LATEST ANSWER'),
    ]);
    let n = 0;
    const model: ModelClient = {
      id: 'gated',
      caps: inner.caps,
      complete: async (req, signal, onText) => {
        if (n++ === 1) await gate;
        return inner.complete(req, signal, onText);
      },
    };
    const m = await open(model);
    await m.send('one');
    await until(() => m.chat.getState().phase === 'idle');
    await tick();
    // Sticky at the bottom: the end of the long reply is in view, the start is not.
    expect(m.frame()).toContain('first line 19');
    expect(m.frame()).not.toContain('first line 0');
    await m.send('two');
    await tick();
    m.app.stdin.write('\x1b[5~'); // page up
    await tick();
    m.app.stdin.write('\x1b[5~');
    await tick();
    const before = m.frame().split('\n')[0];
    release();
    await until(() =>
      m.chat.getState().items.some((i) => i.kind === 'reply' && i.text.includes('LATEST')),
    );
    await tick();
    expect(m.frame().split('\n')[0]).toBe(before);
    expect(m.frame()).not.toContain('LATEST ANSWER');
    // End takes it back to the bottom, where the answer is.
    m.app.stdin.write('\x1b[F');
    await tick();
    expect(m.frame()).toContain('LATEST ANSWER');
    m.app.unmount();
  });
  it('opens the slash menu above the prompt box', async () => {
    const m = await open(new ScriptedModelClient([]));
    m.app.stdin.write('/');
    await tick();
    const lines = m.frame().split('\n');
    const menuAt = lines.findIndex((l) => l.includes('/model'));
    const boxAt = lines.findIndex((l) => l.includes('┃  /'));
    expect(menuAt).toBeGreaterThan(-1);
    expect(boxAt).toBeGreaterThan(menuAt);
    expect(lines.length).toBeLessThanOrEqual(30);
    m.app.unmount();
  });

  it('shows what Remy is doing and how to stop it while a task runs', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = new ScriptedModelClient([done('Finished.')]);
    const model: ModelClient = {
      id: 'gated',
      caps: inner.caps,
      complete: async (req, signal, onText) => {
        await gate;
        return inner.complete(req, signal, onText);
      },
    };
    const m = await open(model);
    await m.send('think hard');
    await tick();
    expect(m.frame()).toContain('esc interrupt');
    expect(m.frame()).not.toContain('/work/proj');
    release();
    await until(() => m.chat.getState().phase === 'idle');
    await tick();
    expect(m.frame()).toContain('/work/proj');
    expect(m.frame()).not.toContain('esc interrupt');
    m.app.unmount();
  });

  it('changes the example in the placeholder after a message', async () => {
    const m = await open(new ScriptedModelClient([done('Hi.')]));
    expect(m.frame()).toContain('Tidy the files in this folder by type');
    await m.send('hello');
    await until(() => m.chat.getState().phase === 'idle');
    await tick();
    expect(m.frame()).toContain('Research the three best standing desks');
    m.app.unmount();
  });
  it('scrolls with page down and page up and jumps with home and end', async () => {
    const answer = Array.from({ length: 40 }, (_, i) => `line number ${i}`).join('\n\n');
    const m = await open(new ScriptedModelClient([done(answer)]));
    await m.send('long one');
    await until(() => m.chat.getState().phase === 'idle');
    await tick();
    expect(m.frame()).toContain('line number 39');
    m.app.stdin.write('\x1b[H'); // home
    await tick();
    expect(m.frame()).toContain('long one');
    expect(m.frame()).not.toContain('line number 39');
    m.app.stdin.write('\x1b[6~'); // page down
    await tick();
    expect(m.frame()).not.toContain('long one');
    m.app.stdin.write('\x1b[5~'); // page up: and back up
    await tick();
    expect(m.frame()).toContain('long one');
    m.app.stdin.write('\x1b[F'); // end
    await tick();
    expect(m.frame()).toContain('line number 39');
    m.app.unmount();
  });

  it('opens the whole conversation with ctrl+o and returns on escape', async () => {
    const m = await open(new ScriptedModelClient([done('Four.')]));
    await m.send('2+2');
    await until(() => m.chat.getState().phase === 'idle');
    m.app.stdin.write('\x0f');
    await tick();
    expect(m.frame()).toContain('scroll');
    expect(m.frame()).not.toContain('ctrl+p commands');
    m.app.stdin.write('\x1b');
    await tick(80);
    expect(m.frame()).toContain('ctrl+p commands');
    m.app.unmount();
  });

  const connect: ChatDeps['connect'] = {
    providers: () => [
      { id: 'openai', label: 'OpenAI', needsKey: true },
      { id: 'ollama', label: 'Ollama', needsKey: false },
    ],
    models: () => [
      { provider: 'openai', model: 'test-model', detail: '$0.05 in' },
      { provider: 'openai', model: 'gpt-4o', detail: '$2.5 in' },
    ],
    login: async () => ({ ok: true, message: 'Connected.', model: 'test-model' }),
    use: async (provider, model) => ({
      ok: true,
      message: `Now using ${model} on ${provider}.`,
      model,
    }),
  };

  it('opens the palette as a centered dialog, grouped, and filters as you type', async () => {
    const m = await open(new ScriptedModelClient([]), { deps: { connect } });
    m.app.stdin.write('\x10'); // ctrl+p
    await until(() => m.chat.getState().overlay === 'palette');
    await tick();
    const f = m.frame();
    const lines = f.split('\n');
    expect(lines.length).toBeLessThanOrEqual(30);
    const title = lines.findIndex((l) => l.includes('Commands'));
    expect(title).toBe(8); // top at a quarter of 30 rows, plus one padding row
    expect(lines[title]).toContain('esc');
    // Centered: the title starts well in from the left edge.
    expect((lines[title] as string).search(/\S/)).toBeGreaterThanOrEqual(6);
    for (const g of ['Session', 'Model', 'View', 'Help']) expect(f).toContain(g);
    m.app.stdin.write('think');
    await tick();
    expect(m.frame()).toContain('/thinking');
    expect(m.frame()).not.toContain('Pick up an unfinished task');
    m.app.stdin.write('\x1b');
    await until(() => !m.chat.getState().overlay);
    await tick();
    expect(m.frame()).not.toContain('Commands');
    m.app.unmount();
  });

  it('picks a model in the dialog and keeps the conversation', async () => {
    const m = await open(new ScriptedModelClient([]), { deps: { connect } });
    m.app.stdin.write('/model');
    await tick();
    m.app.stdin.write('\r');
    await until(() => m.chat.getState().overlay === 'model');
    await tick();
    expect(m.frame()).toContain('Switch model');
    expect(m.frame()).toContain('gpt-4o');
    expect(m.frame()).toContain('in use');
    m.app.stdin.write('4o');
    await tick();
    m.app.stdin.write('\r');
    await until(() => m.chat.getState().model === 'gpt-4o');
    await tick();
    expect(m.chat.getState().overlay).toBeUndefined();
    expect(m.frame()).toContain('gpt-4o');
    expect(m.frame()).not.toContain('Switch model');
    m.app.unmount();
  });

  it('lists providers in the login dialog and moves on to the key in the same frame', async () => {
    const m = await open(new ScriptedModelClient([]), { deps: { connect } });
    m.chat.openOverlay('login');
    await tick();
    expect(m.frame()).toContain('Connect a model provider');
    expect(m.frame()).toContain('OpenAI');
    expect(m.frame()).toContain('Ollama');
    m.app.stdin.write('\r');
    await tick();
    expect(m.frame()).toContain('Connect a model provider');
    expect(m.frame()).toContain('Paste your API key');
    m.app.unmount();
  });

  it('shows the dialog over a session with messages too', async () => {
    const m = await open(new ScriptedModelClient([done('Four.')]), { deps: { connect } });
    await m.send('2+2');
    await until(() => m.chat.getState().phase === 'idle');
    m.app.stdin.write('\x10');
    await until(() => m.chat.getState().overlay === 'palette');
    await tick();
    expect(m.frame()).toContain('Commands');
    expect(m.frame()).toContain('2+2');
    m.app.unmount();
  });

  it('shows the sidebar at 140 columns once there is content, not at 100, and ctrl+b toggles it', async () => {
    const wide = await open(new ScriptedModelClient([done('Four.')]), { size: [140, 40] });
    expect(wide.frame()).not.toContain('CONTEXT');
    await wide.send('what is 2+2');
    await until(() => wide.chat.getState().phase === 'idle');
    await tick();
    expect(wide.frame()).toContain('CONTEXT');
    expect(wide.frame()).toContain('what is 2+2');
    wide.app.stdin.write('\x02'); // ctrl+b
    await tick();
    expect(wide.frame()).not.toContain('CONTEXT');
    wide.app.stdin.write('\x02');
    await tick();
    expect(wide.frame()).toContain('CONTEXT');
    wide.app.unmount();
    const narrow = await open(new ScriptedModelClient([done('Four.')]), { size: [100, 30] });
    await narrow.send('what is 2+2');
    await until(() => narrow.chat.getState().phase === 'idle');
    await tick();
    expect(narrow.frame()).not.toContain('CONTEXT');
    narrow.app.unmount();
  });

  it('shows the sidebar as an overlay below 121 columns; ctrl+b or esc closes it', async () => {
    const m = await open(new ScriptedModelClient([done('Four.')]), { size: [100, 30] });
    await m.send('what is 2+2');
    await until(() => m.chat.getState().phase === 'idle');
    await tick();
    expect(m.frame()).not.toContain('CONTEXT');
    m.app.stdin.write('\x02');
    await tick();
    expect(m.frame()).toContain('CONTEXT');
    m.app.stdin.write('\x02');
    await tick();
    expect(m.frame()).not.toContain('CONTEXT');
    m.app.stdin.write('\x02');
    await tick();
    expect(m.frame()).toContain('CONTEXT');
    expect(m.frame()).toContain('┌'); // NO_COLOR theme: a line marks the overlay's edge
    m.app.stdin.write('\x1b');
    await tick(80);
    expect(m.frame()).not.toContain('CONTEXT');
    m.app.unmount();
  });

  it('searches the history with ctrl+r; enter accepts the match, esc cancels', async () => {
    const m = await open(new ScriptedModelClient([done('One.'), done('Two.')]));
    await m.send('alpha question');
    await until(() => m.chat.getState().phase === 'idle');
    await m.send('beta request');
    await until(() => m.chat.getState().items.filter((i) => i.kind === 'reply').length === 2);
    await tick();
    m.app.stdin.write('\x12'); // ctrl+r
    await tick();
    expect(m.frame()).toContain('search: ');
    expect(m.frame()).toContain('┃  beta request');
    m.app.stdin.write('alp');
    await tick();
    expect(m.frame()).toContain('search: alp');
    expect(m.frame()).toContain('┃  alpha question');
    m.app.stdin.write('\r');
    await tick();
    expect(m.frame()).not.toContain('search: ');
    expect(m.chat.getState().items.filter((i) => i.kind === 'user').length).toBe(2);
    expect(m.frame()).toContain('┃  alpha question▌');
    m.app.stdin.write('\x1b');
    await tick();
    m.app.stdin.write('\x12');
    await tick();
    m.app.stdin.write('\x1b');
    await tick();
    expect(m.frame()).not.toContain('search: ');
    expect(m.frame()).toContain('Ask anything…');
    m.app.unmount();
  });
});

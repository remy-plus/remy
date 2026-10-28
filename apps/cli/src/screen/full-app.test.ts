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
import { createChat, releaseLease } from '../chat.ts';
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
  opts: { auto?: ('read' | 'write')[]; size?: [number, number] } = {},
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
  });
  const app = render(
    h(FullApp, {
      chat,
      theme: createTheme('none'),
      reducedMotion: true,
      subtitle: 'test-model',
      workspace: '/work/proj',
      approvalSettleMs: 0,
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
  it('shows the empty session at 100x30 with the prompt and status under it', async () => {
    const m = await open(new ScriptedModelClient([]));
    const lines = m.frame().split('\n');
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(m.frame()).toContain('REMY');
    expect(m.frame()).toContain('Ask anything…');
    expect(m.frame()).toContain('test-model');
    expect(m.frame()).toContain('/work/proj');
    expect(m.frame()).toContain('ctrl+p commands');
    // No header row and no footer bar: the prompt box is at the bottom.
    expect(lines.at(-2)).toContain('ctrl+p commands');
    m.app.unmount();
  });

  it('fits an 80x24 terminal', async () => {
    const m = await open(new ScriptedModelClient([]), { size: [80, 24] });
    expect(m.frame().split('\n').length).toBeLessThanOrEqual(24);
    expect(m.frame()).toContain('ctrl+p commands');
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
});

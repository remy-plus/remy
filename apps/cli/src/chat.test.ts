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
import { askUser, createScopedFetch, createScopedFs, finish, writeFile } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Chat, createChat, friendlyError, parsePlan, releaseLease } from './chat.ts';

const usage = { inTokens: 10, outTokens: 5 };
const call = (tool: string, args: unknown, text?: string): ModelResponse => ({
  calls: [{ tool, args }],
  usage,
  ...(text && { text }),
});
const done = (answer: string) => call('finish', { answer });
const write = call('write_file', { path: 'a.txt', content: 'hello' });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remy-chat-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness(model: ModelClient, autoApprove: ('read' | 'write')[] = ['read', 'write']) {
  const store = new MemoryEventStore();
  const contexts: number[] = [];
  const chat: Chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([writeFile, askUser, finish]),
        owner: 'chat-test',
        capabilities: (config) => ({
          fs: createScopedFs(config.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        sleep: async () => {},
        ...hooks,
      }),
    config: (context) => {
      contexts.push(context.length);
      return {
        model: model.id,
        permissions: { autoApprove },
        budget: DEFAULT_BUDGET,
        workspaceDir: dir,
        context,
      };
    },
    release: releaseLease(store, 'chat-test'),
  });
  return { chat, store, contexts };
}

const replies = (chat: Chat) =>
  chat.getState().items.flatMap((i) => (i.kind === 'reply' ? [i.text] : []));

describe('chat controller', () => {
  it('carries earlier turns into the next task as context', async () => {
    const model = new ScriptedModelClient([done('Four.'), done('Eight.')]);
    const { chat, store, contexts } = harness(model);
    await chat.submit('what is 2+2');
    await chat.submit('double it');
    expect(replies(chat)).toEqual(['Four.', 'Eight.']);
    expect(contexts).toEqual([0, 1]);
    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
    const second = JSON.stringify(model.requests[1]?.messages);
    expect(second).toContain('what is 2+2');
    expect(second).toContain('Four.');
    expect(chat.history()).toEqual(['what is 2+2', 'double it']);
  });

  it('streams text and clears it when the reply lands', async () => {
    const model = new ScriptedModelClient([call('finish', { answer: 'Hi.' }, 'Hi')]);
    const { chat } = harness(model);
    const seen: string[] = [];
    chat.subscribe(() => seen.push(chat.getState().streaming));
    await chat.submit('hello');
    expect(seen).toContain('Hi');
    expect(chat.getState().streaming).toBe('');
    expect(chat.getState().thinking).toBe(false);
  });

  it('routes the next input to a pending question instead of starting a task', async () => {
    const model = new ScriptedModelClient([
      call('ask_user', { question: 'Which folder?' }),
      done('Sorted Downloads.'),
    ]);
    const { chat, store } = harness(model);
    await chat.submit('sort my files');
    expect(chat.getState().phase).toBe('waiting_user');
    expect(chat.getState().question).toBe('Which folder?');
    await chat.submit('Downloads');
    expect(chat.getState().phase).toBe('idle');
    expect(replies(chat)).toEqual(['Sorted Downloads.']);
    expect(await store.listTasks()).toHaveLength(1);
  });

  it('shows tool state and waits for approval, then runs the tool', async () => {
    const model = new ScriptedModelClient([write, done('Wrote a.txt.')]);
    const { chat } = harness(model, ['read']);
    const lines: string[] = [];
    chat.subscribe(() => {
      const t = chat.getState().tools[0];
      if (t && lines.at(-1) !== t.state) lines.push(t.state);
    });
    await chat.submit('write a file');
    const s = chat.getState();
    expect(s.phase).toBe('waiting_approval');
    expect(s.approval?.risk).toBe('write');
    expect(s.tools[0]).toMatchObject({ tool: 'write_file', state: 'waiting_approval' });
    await chat.approve(true);
    expect(chat.getState().phase).toBe('idle');
    expect(replies(chat)).toEqual(['Wrote a.txt.']);
    expect(lines).toEqual(['running', 'waiting_approval', 'running', 'ok']);
  });

  it('marks a denied call and lets the model adapt', async () => {
    const model = new ScriptedModelClient([write, done('Skipped the file.')]);
    const { chat } = harness(model, ['read']);
    await chat.submit('write a file');
    await chat.approve(false);
    const tool = chat.getState().items.find((i) => i.kind === 'tool');
    expect(tool).toMatchObject({ line: { tool: 'write_file', state: 'denied' } });
    expect(replies(chat)).toEqual(['Skipped the file.']);
  });

  it('interrupts a running task, keeps it resumable and ignores its late results', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: ModelClient = {
      id: 'slow',
      caps: DEFAULT_CAPS,
      complete: async () => {
        await gate;
        return done('Too late.');
      },
    };
    const { chat, store } = harness(slow);
    const run = chat.submit('take your time');
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.getState().phase).toBe('running');
    expect(chat.getState().thinking).toBe(true);
    await chat.interrupt();
    const [task] = await store.listTasks();
    expect(chat.getState().phase).toBe('idle');
    expect(chat.getState().items.at(-1)).toEqual({
      kind: 'note',
      text: `Stopped. Continue with: remy resume ${task?.taskId}`,
    });
    release();
    await run;
    expect(replies(chat)).toEqual([]);
    expect(chat.getState().items.some((i) => i.kind === 'error')).toBe(false);
    expect((await store.listTasks())[0]?.status).toBe('running');
  });

  it('shows a model error as one calm line with the next step', async () => {
    const model = new ScriptedModelClient([new Error('connect ECONNREFUSED')]);
    const { chat } = harness(model);
    await chat.submit('hello');
    const err = chat.getState().items.find((i) => i.kind === 'error');
    expect(err).toBeDefined();
    expect(JSON.stringify(err)).toContain('Send your message again');
    expect(JSON.stringify(err)).not.toContain('!');
  });

  it('handles /help, /new and unknown commands without starting a task', async () => {
    const model = new ScriptedModelClient([done('One.'), done('Two.')]);
    const { chat, store, contexts } = harness(model);
    await chat.submit('/help');
    expect(JSON.stringify(chat.getState().items)).toContain('Ctrl+C');
    await chat.submit('one');
    await chat.submit('/new');
    await chat.submit('two');
    await chat.submit('/nope');
    expect(contexts).toEqual([0, 0]);
    expect(await store.listTasks()).toHaveLength(2);
    expect(JSON.stringify(chat.getState().items.at(-1))).toContain('Unknown command /nope');
    await chat.submit('/exit');
    expect(chat.getState().wantsExit).toBe(true);
  });
});

describe('transcript commits', () => {
  it('commits each user message and each reply exactly once', async () => {
    const model = new ScriptedModelClient([done('One.'), done('Two.')]);
    const { chat } = harness(model);
    await chat.submit('a');
    await chat.submit('b');
    const kinds = chat.getState().items.map((i) => i.kind);
    expect(kinds).toEqual(['user', 'reply', 'user', 'reply']);
  });

  it('keeps narration that comes with a tool call, but not the words of the answer', async () => {
    const model = new ScriptedModelClient([
      call('write_file', { path: 'a.txt', content: 'x' }, 'Writing the file.'),
      call('finish', { answer: 'Wrote it.' }, 'Wrote it.'),
    ]);
    const { chat } = harness(model);
    await chat.submit('go');
    const items = chat.getState().items;
    expect(items.filter((i) => i.kind === 'text')).toEqual([
      { kind: 'text', text: 'Writing the file.' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'text', 'tool', 'reply']);
    expect(chat.getState().tools).toEqual([]);
  });

  it('queues messages sent while a task runs and starts them in order afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let n = 0;
    const slow: ModelClient = {
      id: 'slow',
      caps: DEFAULT_CAPS,
      complete: async () => {
        if (n++ === 0) await gate;
        return done(`Answer ${n}.`);
      },
    };
    const { chat, store } = harness(slow);
    const first = chat.submit('first');
    await new Promise((r) => setTimeout(r, 20));
    await chat.submit('second');
    await chat.submit('third');
    expect(chat.getState().queue).toEqual(['second', 'third']);
    expect(chat.getState().items.filter((i) => i.kind === 'user')).toHaveLength(1);
    release();
    await first;
    expect(chat.getState().queue).toEqual([]);
    expect(replies(chat)).toEqual(['Answer 1.', 'Answer 2.', 'Answer 3.']);
    expect(await store.listTasks()).toHaveLength(3);
  });

  it('drops the queue when the task is stopped, and says so', async () => {
    const slow: ModelClient = {
      id: 'slow',
      caps: DEFAULT_CAPS,
      complete: () => new Promise(() => {}),
    };
    const { chat } = harness(slow);
    void chat.submit('first');
    await new Promise((r) => setTimeout(r, 20));
    await chat.submit('second');
    await chat.interrupt();
    expect(chat.getState().queue).toEqual([]);
    expect(JSON.stringify(chat.getState().items.at(-1))).toContain('1 queued message was dropped');
  });

  it('/clear empties the transcript, starts over and counts the clear', async () => {
    const model = new ScriptedModelClient([done('One.'), done('Two.')]);
    const { chat, contexts } = harness(model);
    await chat.submit('one');
    await chat.submit('/clear');
    expect(chat.getState().items).toEqual([]);
    expect(chat.getState().clears).toBe(1);
    await chat.submit('two');
    expect(contexts).toEqual([0, 0]);
  });

  it('collapses repeated identical failures into one line with a count', async () => {
    const bad = (id: string) => call('write_file', { path: '../x', content: id });
    const model = new ScriptedModelClient([bad('1'), bad('1'), bad('1'), done('Gave up.')]);
    const { chat } = harness(model);
    await chat.submit('try');
    const tools = chat.getState().items.filter((i) => i.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ line: { state: 'failed', count: 3 } });
  });
});

describe('helpers', () => {
  it('reads update_plan args and ignores bad ones', () => {
    expect(
      parsePlan({
        steps: [{ text: 'Read', status: 'done' }, { text: 'Write', status: 'weird' }, { nope: 1 }],
      }),
    ).toEqual([
      { text: 'Read', status: 'done' },
      { text: 'Write', status: 'pending' },
    ]);
    expect(parsePlan({ steps: 'x' })).toBeUndefined();
    expect(parsePlan(null)).toBeUndefined();
  });

  it('turns errors into a sentence with a next step', () => {
    expect(friendlyError(new Error('boom'))).toBe('boom. Send your message again, or run /help.');
  });
});

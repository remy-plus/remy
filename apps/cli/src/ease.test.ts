// The controller side of the ease-of-use work: first run, /model, /login, @files and error wording.
import { createRuntime, DEFAULT_BUDGET, ModelError, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import {
  type ChatDeps,
  type ConnectApi,
  createChat,
  explainModelError,
  friendlyError,
  releaseLease,
} from './chat.ts';

const answer = (text: string) => ({
  calls: [{ tool: 'finish', args: { answer: text } }],
  usage: { inTokens: 1, outTokens: 1 },
});

function make(extra: Partial<ChatDeps> = {}, steps = [answer('Done.')]) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(steps);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'ease',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        sleep: async () => {},
        ...hooks,
      }),
    config: (context) => ({
      model: 'test',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/tmp',
      context,
    }),
    release: releaseLease(store, 'ease'),
    listTasks: () => store.listTasks(),
    readEvents: (id) => store.read(id),
    ...extra,
  });
  return { chat, store };
}

const connect = (over: Partial<ConnectApi> = {}): ConnectApi => ({
  providers: () => [{ id: 'openai', label: 'OpenAI', needsKey: true }],
  models: () => [
    { provider: 'openai', model: 'gpt-5-nano', detail: '$0.05 in, $0.4 out per M' },
    { provider: 'openai', model: 'gpt-4o', detail: '$2.5 in, $10 out per M' },
  ],
  login: async () => ({
    ok: true,
    message: 'Connected openai. Using gpt-5-nano.',
    model: 'gpt-5-nano',
  }),
  use: async (provider, model) => ({
    ok: true,
    message: `Now using ${model} on ${provider}.`,
    model,
  }),
  ...over,
});

describe('first run', () => {
  it('opens on the login panel when no model is connected', () => {
    const { chat } = make({ connect: connect() });
    expect(chat.getState().overlay).toBe('login');
    expect(chat.getState().model).toBeUndefined();
  });

  it('does not open a panel when a model is already in use', () => {
    const { chat } = make({ connect: connect(), model: 'gpt-5-nano' });
    expect(chat.getState().overlay).toBeUndefined();
    expect(chat.getState().model).toBe('gpt-5-nano');
  });

  it('keeps a message sent before connecting and sends it once a model is ready', async () => {
    const { chat } = make({ connect: connect() });
    chat.closeOverlay();
    await chat.submit('hello there');
    expect(chat.getState().overlay).toBe('login');
    expect(chat.getState().queue).toEqual(['hello there']);
    expect(chat.getState().items.at(-1)).toMatchObject({ kind: 'note' });
    const r = await chat.saveLogin({ provider: 'openai', key: 'k' });
    expect(r.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 50));
    const s = chat.getState();
    expect(s.model).toBe('gpt-5-nano');
    expect(s.items.map((i) => i.kind)).toContain('reply');
    expect(s.queue).toEqual([]);
  });

  it('goes on to the model list when a login names no model', async () => {
    const { chat } = make({
      connect: connect({ login: async () => ({ ok: true, message: 'Connected.' }) }),
    });
    await chat.saveLogin({ provider: 'openai', key: 'k' });
    expect(chat.getState().overlay).toBe('model');
    expect(chat.getState().model).toBeUndefined();
  });

  it('shows a bad key on the panel and stays unconnected', async () => {
    const { chat } = make({
      connect: connect({
        login: async () => ({ ok: false, message: 'That key was not accepted.' }),
      }),
    });
    const r = await chat.saveLogin({ provider: 'openai', key: 'bad' });
    expect(r.ok).toBe(false);
    expect(chat.getState().model).toBeUndefined();
  });
});

describe('/model, /login and /sessions', () => {
  it('opens the model list, the login panel and takes aliases', async () => {
    const { chat } = make({ connect: connect(), model: 'gpt-5-nano' });
    await chat.submit('/model');
    expect(chat.getState().overlay).toBe('model');
    chat.closeOverlay();
    await chat.submit('/login');
    expect(chat.getState().overlay).toBe('login');
    chat.closeOverlay();
    await chat.submit('/models');
    expect(chat.getState().overlay).toBe('model');
  });

  it('switches by name and keeps the conversation going', async () => {
    const { chat } = make({ connect: connect(), model: 'gpt-5-nano' }, [
      answer('one'),
      answer('two'),
    ]);
    await chat.submit('first');
    await chat.submit('/model gpt-4o');
    const s = chat.getState();
    expect(s.model).toBe('gpt-4o');
    expect(JSON.stringify(s.items.at(-1))).toContain('Now using gpt-4o');
    await chat.submit('second');
    expect(chat.getState().items.filter((i) => i.kind === 'reply')).toHaveLength(2);
  });

  it('says so when a switch fails, and keeps the old model', async () => {
    const { chat } = make({
      connect: connect({
        use: async () => ({
          ok: false,
          message: 'There is no key for openai. Run /login to add one.',
        }),
      }),
      model: 'gpt-5-nano',
    });
    await chat.chooseModel('openai', 'gpt-4o');
    expect(chat.getState().model).toBe('gpt-5-nano');
    expect(chat.getState().items.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('runs a command picked from the palette and closes it', async () => {
    const { chat } = make({ connect: connect(), model: 'm' });
    chat.openOverlay('palette');
    await chat.runCommand('help');
    expect(chat.getState().overlay).toBeUndefined();
    expect(JSON.stringify(chat.getState().items.at(-1))).toContain('Commands');
  });

  it('lists the new commands in /help', async () => {
    const { chat } = make();
    await chat.submit('/help');
    const text = JSON.stringify(chat.getState().items.at(-1));
    for (const w of ['/model', '/login', '/sessions', 'Ctrl+P', '@']) expect(text).toContain(w);
  });
});

describe('@ files', () => {
  const files = {
    list: async () => [{ name: 'notes.txt', dir: false }],
    read: async (p: string) => (p === 'notes.txt' ? 'Buy milk.\nCall Sam.' : undefined),
  };

  it('shows the user their own words and sends the file as untrusted context', async () => {
    const { chat, store } = make({ files, model: 'm' });
    await chat.submit('summarize @notes.txt');
    const items = chat.getState().items;
    expect(items[0]).toEqual({ kind: 'user', text: 'summarize @notes.txt' });
    expect(JSON.stringify(items)).toContain('Attached notes.txt.');
    const [task] = await store.listTasks();
    const first = (await store.read(task?.taskId as string))[0]?.event;
    expect(first?.type === 'task.created' && first.config.pasted).toEqual(['Buy milk.\nCall Sam.']);
    expect(task?.prompt).toContain('Buy milk.');
  });

  it('says which file could not be read and still sends the message', async () => {
    const { chat } = make({ files, model: 'm' });
    await chat.submit('open @missing.txt');
    expect(JSON.stringify(chat.getState().items)).toContain('Could not read missing.txt');
    expect(chat.getState().items.map((i) => i.kind)).toContain('reply');
  });

  it('completes paths through the workspace listing', async () => {
    const { chat } = make({ files });
    expect(await chat.completeFiles('no')).toEqual(['notes.txt']);
  });
});

describe('errors end with the next step', () => {
  it.each([
    ['HTTP 401: Incorrect API key provided', '/login'],
    ['HTTP 429: Rate limit reached', '/model'],
    ['network error: fetch failed', 'connection'],
    ['HTTP 402: insufficient_quota', 'credit'],
    ['HTTP 404: The model gpt-9 does not exist', '/model'],
  ])('%s', (msg, next) => {
    const text = explainModelError(msg) ?? '';
    expect(text).toContain(next);
    expect(text).not.toContain('!');
    expect(friendlyError(new ModelError(msg, false))).toBe(text);
  });

  it('leaves unknown errors with the generic next step', () => {
    expect(explainModelError('something odd')).toBeUndefined();
    expect(friendlyError(new ModelError('something odd', false))).toContain('/model');
  });
});

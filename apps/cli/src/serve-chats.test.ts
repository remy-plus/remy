// The chat routes, through a real `remy serve` listener with a fake model and a temp REMY_HOME.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type ModelResponse,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { finish } from '@remy/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpError, listenServe, type ServeListening } from './serve.ts';
import { chatRoutes, contextFrom, openChats, titleFrom } from './serve-chats.ts';
import { makeServeToken, serveTokenHash } from './serve-token.ts';

const usage = { inTokens: 10, outTokens: 10 };
const answer = (text: string): ModelResponse => ({
  calls: [{ tool: 'finish', args: { answer: text } }],
  usage,
});

let home: string;
let token: string;
let open: ServeListening[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-chats-'));
  token = makeServeToken(home);
});
afterEach(async () => {
  await Promise.all(open.map((s) => s.close()));
  open = [];
  rmSync(home, { recursive: true, force: true });
});

interface CallOpts {
  method?: string;
  token?: string | null;
  body?: unknown;
}

async function rig(opts: { overBudget?: boolean; firstReadsPage?: boolean } = {}) {
  const store = new MemoryEventStore();
  const runtime = createRuntime({
    store,
    model: new ScriptedModelClient(
      opts.firstReadsPage
        ? [
            { calls: [{ tool: 'peek', args: {} }], usage },
            ...Array.from({ length: 12 }, (_, i) => answer(`Answer ${i + 1}.`)),
          ]
        : Array.from({ length: 12 }, (_, i) => answer(`Answer ${i + 1}.`)),
    ),
    tools: new ToolRegistry([
      finish,
      defineTool({
        name: 'peek',
        description: 'Read a page',
        args: z.object({}),
        risk: 'read',
        effect: 'none',
        outputTrust: 'untrusted',
        timeoutMs: 1000,
        maxOutputChars: 1000,
        preview: () => 'Read a page',
        execute: async () => ({ ok: true, content: 'page text', trust: 'untrusted' }),
      }),
    ]),
    capabilities: () => ({}) as never,
    leaseMs: 300,
    sleep: async () => {},
  });
  const s = await listenServe(
    {
      routes: [chatRoutes({ home, store })],
      store,
      runtime,
      home,
      version: '9.9.9',
      config: () => ({
        model: 'scripted',
        permissions: { autoApprove: ['read'] },
        budget: DEFAULT_BUDGET,
        workspaceDir: '/w',
      }),
      beforeStart: async () => {
        if (opts.overBudget) throw new HttpError(402, 'This month is used up.');
      },
      tokenHash: () => serveTokenHash(home),
      log: () => {},
      pollMs: 20,
      busyMs: 50,
    },
    { host: '127.0.0.1', port: 0 },
  );
  open.push(s);
  const api = async (path: string, o: CallOpts = {}) => {
    const t = o.token === undefined ? token : o.token;
    const res = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method: o.method ?? (o.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(t && { authorization: `Bearer ${t}` }),
        ...(o.body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: a loose view of JSON, for assertions
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json };
  };
  const finished = async (chatId: string, turns: number) => {
    const end = Date.now() + 4000;
    for (;;) {
      const r = await api(`/api/chats/${chatId}`);
      const done = (r.json.turns ?? []).filter((t: { state: string }) => t.state === 'done');
      if (done.length >= turns) return r.json;
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((x) => setTimeout(x, 15));
    }
  };
  return { s, store, api, finished };
}

const configOf = async (store: MemoryEventStore, taskId: string) => {
  const events = await store.read(taskId);
  const created = events.find((e) => e.event.type === 'task.created')?.event as unknown as {
    config: { context?: unknown };
  };
  return created.config;
};

describe('chats', () => {
  it('creates a chat from a first message, lists it and returns its turns', async () => {
    const { api, finished } = await rig();
    const sent = await api('/api/chats/messages', {
      body: { text: 'What is on my calendar today?' },
    });
    expect(sent.status).toBe(201);
    expect(sent.json.chatId).toMatch(/^chat_/);
    expect(sent.json.taskId).toMatch(/^task_/);
    const view = await finished(sent.json.chatId, 1);
    expect(view.title).toBe('What is on my calendar today');
    expect(view.turns[0]).toMatchObject({
      taskId: sent.json.taskId,
      prompt: 'What is on my calendar today?',
      state: 'done',
      answer: 'Answer 1.',
    });
    expect(typeof view.turns[0].at).toBe('string');
    const list = await api('/api/chats');
    expect(list.json.chats).toHaveLength(1);
    expect(list.json.chats[0]).toMatchObject({
      id: sent.json.chatId,
      state: 'resting',
      preview: 'Answer 1.',
    });
    expect(Object.keys(list.json.chats[0]).sort()).toEqual([
      'id',
      'preview',
      'state',
      'title',
      'updatedAt',
    ]);
  });

  it('gives a second message the finished turns as context', async () => {
    const { api, finished, store } = await rig();
    const first = await api('/api/chats/messages', { body: { text: 'First question' } });
    await finished(first.json.chatId, 1);
    const second = await api('/api/chats/messages', {
      body: { chatId: first.json.chatId, text: 'Second question' },
    });
    expect(second.status).toBe(201);
    expect(second.json.chatId).toBe(first.json.chatId);
    expect((await configOf(store, second.json.taskId)).context).toEqual([
      { prompt: 'First question', answer: 'Answer 1.' },
    ]);
    const view = await finished(first.json.chatId, 2);
    expect(view.turns.map((t: { prompt: string }) => t.prompt)).toEqual([
      'First question',
      'Second question',
    ]);
    expect((await configOf(store, first.json.taskId)).context).toBeUndefined();
  });

  it('renames a chat and deletes only the record', async () => {
    const { api, finished, store } = await rig();
    const sent = await api('/api/chats/messages', { body: { text: 'Plan my week' } });
    await finished(sent.json.chatId, 1);
    const id = sent.json.chatId;
    const renamed = await api(`/api/chats/${id}`, { method: 'PUT', body: { title: 'Week plan' } });
    expect(renamed.status).toBe(200);
    expect((await api('/api/chats')).json.chats[0].title).toBe('Week plan');
    expect((await api(`/api/chats/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api('/api/chats')).json.chats).toEqual([]);
    expect((await api(`/api/chats/${id}`)).status).toBe(404);
    expect((await store.listTasks()).map((t) => t.taskId)).toContain(sent.json.taskId);
  });

  it('answers 404 for an unknown chat, 400 for bad bodies, 401 without a token', async () => {
    const { api } = await rig();
    const post = (body: unknown, t?: string | null) =>
      api('/api/chats/messages', { body, ...(t !== undefined && { token: t }) });
    expect((await api('/api/chats/chat_nope')).status).toBe(404);
    expect(
      (await api('/api/chats/chat_nope', { method: 'PUT', body: { title: 'x' } })).status,
    ).toBe(404);
    expect((await api('/api/chats/chat_nope', { method: 'DELETE' })).status).toBe(404);
    expect((await post({ chatId: 'chat_nope', text: 'hi' })).status).toBe(404);
    expect((await post({ text: '  ' })).status).toBe(400);
    expect((await post({ text: 'hi', extra: 1 })).status).toBe(400);
    expect((await post({ text: 'hi', trust: 'wild' })).status).toBe(400);
    expect((await post({ text: 'x'.repeat(20_001) })).status).toBe(400);
    expect((await post({ text: 'hi' }, null)).status).toBe(401);
    expect((await api('/api/chats', { token: null })).status).toBe(401);
  });

  it('refuses a message with 402 when the month is used up, and makes no chat', async () => {
    const { api } = await rig({ overBudget: true });
    const r = await api('/api/chats/messages', { body: { text: 'hello' } });
    expect(r.status).toBe(402);
    expect((await api('/api/chats')).json.chats).toEqual([]);
  });
});

describe('the chat store', () => {
  it('survives a reopen, is private, and tolerates a damaged file', () => {
    const a = openChats(home);
    const chat = a.create('Hello', 'task_1');
    a.append(chat.id, 'task_2');
    expect(openChats(home).get(chat.id)?.taskIds).toEqual(['task_1', 'task_2']);
    expect(statSync(join(home, 'chats.json')).mode & 0o777).toBe(0o600);
    writeFileSync(join(home, 'chats.json'), '{ not json');
    expect(openChats(home).list()).toEqual([]);
    writeFileSync(join(home, 'chats.json'), '{"chats":"nope"}');
    expect(openChats(home).list()).toEqual([]);
  });
});

describe('titles and context', () => {
  it('cuts a title at a word boundary without trailing marks', () => {
    expect(titleFrom('  hi there!  ')).toBe('hi there');
    const t = titleFrom('Please summarise every unread email from my landlord about the boiler');
    expect(t.length).toBeLessThanOrEqual(48);
    expect(t).toBe('Please summarise every unread email from my');
    expect(titleFrom('')).toBe('New chat');
  });

  it('keeps the last 10 turns and about 8,000 characters, oldest first', () => {
    const turn = (i: number, len: number) =>
      ({
        status: 'succeeded',
        prompt: `q${i}`,
        final: { status: 'succeeded', answer: 'a'.repeat(len) },
      }) as never;
    const many = contextFrom(Array.from({ length: 14 }, (_, i) => turn(i, 10)));
    expect(many.map((t) => t.prompt)).toEqual(Array.from({ length: 10 }, (_, i) => `q${i + 4}`));
    const big = contextFrom([turn(0, 5000), turn(1, 5000), turn(2, 5000)]);
    const chars = big.reduce((n, t) => n + t.prompt.length + t.answer.length, 0);
    expect(chars).toBeLessThanOrEqual(8000);
    expect(big.at(-1)?.prompt).toBe('q2');
  });

  it('starts a follow-up tainted when an earlier turn read untrusted content', async () => {
    const { api, finished, store } = await rig({ firstReadsPage: true });
    const first = await api('/api/chats/messages', { body: { text: 'Read that page' } });
    await finished(first.json.chatId, 1);
    expect(fold(await store.read(first.json.taskId)).tainted).toBe(true);
    const next = await api('/api/chats/messages', {
      body: { chatId: first.json.chatId, text: 'Now do something' },
    });
    expect(
      ((await configOf(store, next.json.taskId)) as { startTainted?: boolean }).startTainted,
    ).toBe(true);
    await finished(first.json.chatId, 2);
    expect(fold(await store.read(next.json.taskId)).tainted).toBe(true);
  });

  it('does not taint a follow-up when no earlier turn read untrusted content', async () => {
    const { api, finished, store } = await rig();
    const first = await api('/api/chats/messages', { body: { text: 'Say hi' } });
    await finished(first.json.chatId, 1);
    const next = await api('/api/chats/messages', {
      body: { chatId: first.json.chatId, text: 'Again' },
    });
    expect(
      ((await configOf(store, next.json.taskId)) as { startTainted?: boolean }).startTainted,
    ).toBeUndefined();
    await finished(first.json.chatId, 2);
    expect(fold(await store.read(next.json.taskId)).tainted).toBe(false);
  });
});

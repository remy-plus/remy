import { describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpApi, createSseParser } from './http.ts';
import { chooseApi } from './index.tsx';
import { createMockApi } from './mock.ts';
import type { StreamEvent } from './types.ts';

describe('mock adapter', () => {
  it('lists tasks in the shape of GET /api/tasks', async () => {
    const tasks = await createMockApi().listTasks();
    expect(tasks.length).toBeGreaterThan(4);
    for (const t of tasks) {
      expect(t).toMatchObject({
        id: expect.stringMatching(/^task_/),
        prompt: expect.any(String),
        status: expect.any(String),
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        updatedAt: expect.any(String),
        costUsd: expect.any(Number),
      });
    }
    const waiting = await createMockApi().listTasks({ status: 'waiting_approval' });
    expect(waiting.every((t) => t.status === 'waiting_approval')).toBe(true);
  });

  it('returns a task view with its approval card, and applies approve and cancel', async () => {
    const api = createMockApi();
    const view = await api.getTask('task_flights');
    expect(view.pendingApproval).toMatchObject({ risk: 'spend_money', callId: expect.any(String) });
    await expect(
      api.approve('task_flights', { callId: 'call_flights', argsHash: 'wrong', granted: true }),
    ).rejects.toThrow('different arguments');
    const card = view.pendingApproval;
    if (!card) throw new Error('expected a card');
    await api.approve('task_flights', {
      callId: card.callId,
      argsHash: card.argsHash,
      granted: true,
    });
    expect((await api.getTask('task_flights')).pendingApproval).toBeUndefined();
    await api.cancel('task_audit');
    expect((await api.getTask('task_audit')).status).toBe('cancelled');
  });

  it('starts a task and streams events after lastEventId', async () => {
    const api = createMockApi();
    const { taskId } = await api.startTask('Do a thing');
    expect((await api.getTask(taskId)).prompt).toBe('Do a thing');
    const seen: StreamEvent[] = [];
    await api.streamTask('task_flights', (e) => seen.push(e), { lastEventId: 1 });
    expect(seen.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(seen.at(-1)?.event.type).toBe('approval.requested');
  });

  it('builds the Home data', async () => {
    const home = await createMockApi().home();
    expect(home.needsYou.map((c) => c.taskId)).toEqual(['task_flights', 'task_correction']);
    expect(home.briefing.headline).toBe('Three things need you.');
    expect(home.working).toHaveLength(4);
    expect(home.noticed).toHaveLength(3);
    expect(home.brain?.notes).toBe(1204);
  });
});

describe('adapter choice', () => {
  it('uses the mock with ?mock=1 or without a token, otherwise http', () => {
    expect(chooseApi('?mock=1', 'tok').kind).toBe('mock');
    expect(chooseApi('', null).kind).toBe('mock');
    expect(chooseApi('', 'tok').kind).toBe('http');
  });
});

describe('http adapter', () => {
  it('sends the bearer token and unwraps the list', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), { status: 200 }));
    const api = createHttpApi({ token: () => 'secret', fetch: fetcher as unknown as typeof fetch });
    expect(await api.listTasks({ status: 'running', limit: 5 })).toEqual([]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks?status=running&limit=5');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
  });

  it('posts the approval body as the server expects it', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const api = createHttpApi({ token: () => 't', fetch: fetcher as unknown as typeof fetch });
    await api.approve('task_1', { callId: 'c', argsHash: 'h', granted: false, note: 'no' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks/task_1/approve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      callId: 'c',
      argsHash: 'h',
      granted: false,
      note: 'no',
    });
  });

  it('turns an error response into an ApiError with the server message', async () => {
    const fetcher = vi.fn(
      async () => new Response('{"error":"A valid bearer token is required."}', { status: 401 }),
    );
    const api = createHttpApi({ token: () => null, fetch: fetcher as unknown as typeof fetch });
    const err = await api.getTask('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: 'A valid bearer token is required.' });
  });

  it('streams server-sent events, even split across chunks', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(
          enc.encode('retry: 2000\n\nid: 1\ndata: {"seq":1,"at":"t","event":{"type":"task.cr'),
        );
        c.enqueue(
          enc.encode(
            'eated"}}\n\n: keepalive\n\nid: 2\ndata: {"seq":2,"at":"t","event":{"type":"task.finished"}}\n\n',
          ),
        );
        c.close();
      },
    });
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));
    const api = createHttpApi({ token: () => 't', fetch: fetcher as unknown as typeof fetch });
    const seen: StreamEvent[] = [];
    await api.streamTask('task_1', (e) => seen.push(e), { lastEventId: 4 });
    expect(seen.map((e) => e.event.type)).toEqual(['task.created', 'task.finished']);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('last-event-id')).toBe('4');
  });

  it('skips a damaged event line', () => {
    const seen: StreamEvent[] = [];
    createSseParser((e) => seen.push(e))(
      'data: {oops\n\ndata: {"seq":1,"at":"t","event":{"type":"x"}}\n\n',
    );
    expect(seen).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { applyServerPrefs, bindServerSettings, getSetting, setSetting } from '../settings.ts';
import { ApiError, createHttpApi, createSseParser } from './http.ts';
import { chooseApi } from './index.tsx';
import { createMockApi } from './mock.ts';
import type { ServerPrefs, StreamEvent } from './types.ts';

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

  describe('connections, skills, schedules and the brain', () => {
    const stub = (reply: unknown = { ok: true }, status = 200) => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(reply), { status }));
      const api = createHttpApi({ token: () => 'tok', fetch: fetcher as unknown as typeof fetch });
      const last = () => {
        const [url, init] = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
        return {
          url,
          method: init.method,
          body: init.body ? JSON.parse(init.body as string) : undefined,
          auth: new Headers(init.headers).get('authorization'),
        };
      };
      return { api, last, fetcher };
    };

    it('reads connections and the catalog, and sends permission changes', async () => {
      const { api, last } = stub({ apps: [], machines: [] });
      expect(await api.connections()).toEqual({ apps: [], machines: [] });
      expect(last()).toMatchObject({ url: '/api/connections', auth: 'Bearer tok' });
      await api.setPermission('notion', 'update_page', false);
      expect(last()).toMatchObject({
        url: '/api/connections/notion/permissions',
        method: 'POST',
        body: { permissionId: 'update_page', on: false },
      });
      await api.disconnectApp('notion');
      expect(last()).toMatchObject({ url: '/api/connections/notion', method: 'DELETE' });
      const cat = stub({ apps: [{ id: 'linear', name: 'Linear', blurb: '', levels: [] }] });
      expect((await cat.api.appCatalog()).map((a) => a.id)).toEqual(['linear']);
      expect(cat.last().url).toBe('/api/catalog');
      await api.connectApp('linear', 'act');
      expect(last()).toMatchObject({
        url: '/api/connections',
        method: 'POST',
        body: { catalogId: 'linear', level: 'act' },
      });
    });

    it('never sends a key path with a machine', async () => {
      const { api, last } = stub({ ok: true, lines: ['Connected.'] });
      const m = { name: 'home', host: 'h.example.com', port: 22, user: 'remy', keyPath: '/k/id' };
      expect((await api.testMachine(m)).ok).toBe(true);
      expect(last()).toMatchObject({
        url: '/api/machines/test',
        body: { name: 'home', host: 'h.example.com', user: 'remy', port: 22 },
      });
      expect(JSON.stringify(last().body)).not.toContain('/k/id');
      await api.addMachine({ ...m, port: 0 });
      expect(last()).toMatchObject({ url: '/api/machines', method: 'POST' });
      expect(last().body).toEqual({ name: 'home', host: 'h.example.com', user: 'remy' });
    });

    it('calls the skill routes', async () => {
      const { api, last } = stub({ skills: [], suggestion: null });
      expect(await api.skills()).toEqual({ skills: [], suggestion: null });
      await api.setSkillEnabled('rename receipts', false);
      expect(last()).toMatchObject({
        url: '/api/skills/rename%20receipts/enabled',
        body: { enabled: false },
      });
      const run = stub({ taskId: 'task_1' });
      expect(await run.api.runSkill('one')).toEqual({ taskId: 'task_1' });
      expect(run.last()).toMatchObject({ url: '/api/skills/one/run', method: 'POST' });
    });

    it('calls the schedule routes and sends only the prompt and the phrase', async () => {
      const { api, last } = stub({ id: 'sched_1' });
      expect(
        await api.createSchedule({
          prompt: 'Draft it',
          when: 'every day at 9',
          timezone: 'Europe/London',
          runsOn: 'this machine',
        }),
      ).toEqual({ id: 'sched_1' });
      expect(last()).toMatchObject({
        url: '/api/schedules',
        method: 'POST',
        body: { prompt: 'Draft it', when: 'every day at 9' },
      });
      await api.setScheduleEnabled('sched_1', false);
      expect(last()).toMatchObject({
        url: '/api/schedules/sched_1/enabled',
        body: { enabled: false },
      });
      await api.runScheduleNow('sched_1');
      expect(last()).toMatchObject({ url: '/api/schedules/sched_1/run', method: 'POST' });
      await api.setWebhookEnabled('new-invoice', true);
      expect(last()).toMatchObject({
        url: '/api/webhooks/new-invoice/enabled',
        body: { enabled: true },
      });
    });

    it('calls the brain routes', async () => {
      const { api, last } = stub({ total: 0 });
      await api.brain();
      expect(last()).toMatchObject({ url: '/api/brain', auth: 'Bearer tok' });
      await api.updateNote('mem_1', 'Lives in Porto');
      expect(last()).toMatchObject({
        url: '/api/brain/mem_1',
        method: 'PUT',
        body: { text: 'Lives in Porto' },
      });
      await api.deleteNote('mem_1');
      expect(last()).toMatchObject({ url: '/api/brain/mem_1', method: 'DELETE' });
    });

    it('shows the server message when a change is refused', async () => {
      const { api } = stub({ error: 'Remy will not add a command from the web app.' }, 400);
      const err = await api.connectApp('x', 'act').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({
        status: 400,
        message: 'Remy will not add a command from the web app.',
      });
    });

    it('says what is done in the terminal, for sign-in and suggestions', async () => {
      const { api } = stub();
      await expect(api.signInApp('slack')).rejects.toThrow('remy connect auth');
      await expect(api.resolveSuggestion(true)).rejects.toBeInstanceOf(ApiError);
    });
  });

  it('skips a damaged event line', () => {
    const seen: StreamEvent[] = [];
    createSseParser((e) => seen.push(e))(
      'data: {oops\n\ndata: {"seq":1,"at":"t","event":{"type":"x"}}\n\n',
    );
    expect(seen).toHaveLength(1);
  });
});

describe('http adapter, home to settings', () => {
  const stub = (body: unknown = {}, status = 200) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const api = createHttpApi({ token: () => 'tok', fetch: fetcher as unknown as typeof fetch });
    const last = () => {
      const [url, init] = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
      return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
    };
    return { api, fetcher, last };
  };

  it('reads home and the review from the server', async () => {
    const { api, last } = stub({ status: { running: 2 } });
    expect((await api.home()).status.running).toBe(2);
    expect(last().url).toBe('/api/home');
    await api.review();
    expect(last().url).toBe('/api/review');
    await api.review('7d');
    expect(last().url).toBe('/api/review?since=7d');
    expect(new Headers(last().init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('reads and saves settings', async () => {
    const { api, last } = stub({ currency: '$' });
    expect((await api.settings()).currency).toBe('$');
    expect(last().url).toBe('/api/settings');
    await api.updateSettings({ trust: 'away', budget: { perTask: 3 } });
    expect(last().init.method).toBe('PUT');
    expect(last().body).toEqual({ trust: 'away', budget: { perTask: 3 } });
  });

  it('sends the note count the person was shown, and shows the server message when it differs', async () => {
    const { api, last } = stub({ deleted: 3 });
    expect(await api.deleteNotes(3)).toEqual({ deleted: 3 });
    expect(last().url).toBe('/api/notes/delete-all');
    expect(last().body).toEqual({ confirm: 3 });
    const wrong = stub({ error: 'There are 4 notes, not 3. Nothing was deleted.' }, 409);
    await expect(wrong.api.deleteNotes(3)).rejects.toMatchObject({
      status: 409,
      message: 'There are 4 notes, not 3. Nothing was deleted.',
    });
  });

  it('rotates the token, tests the model and sends a test notification', async () => {
    const rotate = stub({ token: 'new-token' });
    expect(await rotate.api.rotateToken()).toEqual({ token: 'new-token' });
    expect(rotate.last().url).toBe('/api/token/rotate');
    expect(rotate.last().init.method).toBe('POST');
    const model = stub({ ok: true, detail: 'llama3 answered.' });
    expect(await model.api.testModels()).toEqual({ ok: true, detail: 'llama3 answered.' });
    expect(model.last().url).toBe('/api/models/test');
    const note = stub({ ok: true });
    await expect(note.api.sendTestNotification()).resolves.toBeUndefined();
    expect(note.last().url).toBe('/api/notifications/test');
  });

  it('still says the two methods with no server source are not connected', async () => {
    const { api } = stub();
    await expect(api.signInApp('slack')).rejects.toMatchObject({ status: 501 });
    await expect(api.resolveSuggestion(true)).rejects.toMatchObject({ status: 501 });
  });
});

describe('settings copied to and from the server', () => {
  const prefs: ServerPrefs = {
    trust: 'steady',
    budget: { monthly: 30, perTask: 4 },
    currency: { code: 'GBP', perUsd: 0.79 },
    remember: false,
    quiet: true,
    quietHours: { from: '22:00', to: '06:30' },
    notifications: { approvals: true, finished: false, noticed: true, reviewAt: '08:15' },
    appearance: 'dark',
  };

  it('copies the server values in without sending them back, then sends each change', () => {
    const sent: unknown[] = [];
    bindServerSettings((p) => sent.push(p));
    applyServerPrefs(prefs);
    expect(sent).toEqual([]);
    expect(getSetting('trust')).toBe('steady');
    expect(getSetting('budget.month')).toBe(30);
    expect(getSetting('notify.review')).toBe('08:15');
    expect(getSetting('quiet.to')).toBe('06:30');
    setSetting('trust', 'away');
    setSetting('budget.task', 5);
    setSetting('notify.noticed', false);
    setSetting('escalate', false); // stays in this browser
    expect(sent).toEqual([
      { trust: 'away' },
      { budget: { perTask: 5 } },
      { notifications: { noticed: false } },
    ]);
    bindServerSettings(null);
    setSetting('trust', 'ask');
    expect(sent).toHaveLength(3);
  });
});

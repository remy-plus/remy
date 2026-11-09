// The real adapter: fetch with a bearer token. Streaming uses fetch, not EventSource, because
// EventSource cannot send an Authorization header.
import type {
  ApproveBody,
  BrainData,
  CatalogApp,
  ConnectionsData,
  ExtendBody,
  Health,
  HomeData,
  MachineInput,
  MachineTest,
  RemyApi,
  ReviewData,
  SchedulesData,
  SettingsData,
  SkillsData,
  StreamEvent,
  TaskListItem,
  TaskView,
  TrustLevel,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Splits a server-sent-events stream into events. Keeps the partial tail between chunks. */
export function createSseParser(onEvent: (e: StreamEvent) => void) {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk.replaceAll('\r\n', '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue; // a comment, a retry hint or a keepalive
      try {
        onEvent(JSON.parse(data) as StreamEvent);
      } catch {
        // A damaged line is skipped; the next event carries on.
      }
    }
  };
}

const NOT_YET = 'Not connected to a server yet';
const no = () => Promise.reject(new ApiError(501, NOT_YET));
/** Still mock only: the server has no route for these. */
const notAvailable = {
  // Signing in to an app happens in a browser window on the machine Remy runs on.
  signInApp: () =>
    Promise.reject(
      new ApiError(501, 'Signing in is done in the terminal: run remy connect auth <name>.'),
    ),
  // The CLI never suggests skills, so the list says `suggestion: null` and this is never called.
  resolveSuggestion: no,
} satisfies Partial<RemyApi>;
/** The server has no routes for settings yet. */
const notYet = <T>(): Promise<T> => Promise.reject(new Error('This is not available yet.'));

export function createHttpApi(opts: {
  token: () => string | null;
  base?: string;
  fetch?: typeof fetch;
}): RemyApi {
  const base = opts.base ?? '';
  const doFetch: typeof fetch = (...a) => (opts.fetch ?? fetch)(...a);

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = opts.token();
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (init.body) headers.set('content-type', 'application/json');
    const res = await doFetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? 'The request failed.');
    }
    return res;
  }
  const json = async <T>(path: string, init?: RequestInit) =>
    (await (await call(path, init)).json()) as T;
  const post = async (path: string, body: unknown = {}) => {
    await call(path, { method: 'POST', body: JSON.stringify(body) });
  };
  const send = async (method: string, path: string, body?: unknown) => {
    await call(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  };
  const machineBody = (m: MachineInput) => ({
    name: m.name,
    host: m.host,
    user: m.user,
    ...(m.port ? { port: m.port } : {}),
  });
  const machineRequest = (m: MachineInput): RequestInit => ({
    method: 'POST',
    body: JSON.stringify(machineBody(m)),
  });
  const task = (id: string) => `/api/tasks/${encodeURIComponent(id)}`;

  const api: RemyApi = {
    kind: 'http',
    async listTasks(q) {
      const p = new URLSearchParams();
      if (q?.status) p.set('status', q.status);
      if (q?.limit) p.set('limit', String(q.limit));
      const qs = p.size ? `?${p}` : '';
      return (await json<{ tasks: TaskListItem[] }>(`/api/tasks${qs}`)).tasks;
    },
    startTask: (prompt, trust?: TrustLevel) =>
      json('/api/tasks', { method: 'POST', body: JSON.stringify({ prompt, trust }) }),
    getTask: (id) => json<TaskView>(task(id)),
    async streamTask(id, onEvent, o) {
      const headers: Record<string, string> = {};
      if (o?.lastEventId) headers['last-event-id'] = String(o.lastEventId);
      const res = await call(`${task(id)}/stream`, { headers, signal: o?.signal ?? null });
      if (!res.body) return;
      const feed = createSseParser(onEvent);
      const decoder = new TextDecoder();
      const reader = res.body.getReader(); // not `for await`: Safari cannot iterate a stream
      try {
        for (let r = await reader.read(); !r.done; r = await reader.read())
          feed(decoder.decode(r.value, { stream: true }));
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
      }
    },
    approve: (id, body: ApproveBody) => post(`${task(id)}/approve`, body),
    answer: (id, answer) => post(`${task(id)}/answer`, { answer }),
    cancel: (id) => post(`${task(id)}/cancel`),
    extend: (id, body: ExtendBody = {}) => post(`${task(id)}/extend`, body),
    async home(): Promise<HomeData> {
      const tasks = await api.listTasks({ limit: 50 });
      return homeFromTasks(tasks, await waitingCards(api, tasks));
    },
    // No server routes yet for the two below.
    async review(): Promise<ReviewData> {
      throw new ApiError(404, 'The overnight review is not available from the server yet.');
    },
    async markDone(): Promise<void> {
      throw new ApiError(404, 'Marking a task done is not available from the server yet.');
    },
    // Connections, machines, skills, schedules, webhooks and the brain are served by remy serve.
    connections: () => json<ConnectionsData>('/api/connections'),
    setPermission: (appId, permissionId, on) =>
      post(`/api/connections/${encodeURIComponent(appId)}/permissions`, { permissionId, on }),
    disconnectApp: (appId) => send('DELETE', `/api/connections/${encodeURIComponent(appId)}`),
    async appCatalog() {
      return (await json<{ apps: CatalogApp[] }>('/api/catalog')).apps;
    },
    connectApp: (catalogId, level) => post('/api/connections', { catalogId, level }),
    // The key is never sent: the server uses the keys of the account Remy runs under.
    testMachine: (m) => json<MachineTest>('/api/machines/test', machineRequest(m)),
    addMachine: (m) => post('/api/machines', machineBody(m)),
    skills: () => json<SkillsData>('/api/skills'),
    setSkillEnabled: (name, enabled) =>
      post(`/api/skills/${encodeURIComponent(name)}/enabled`, { enabled }),
    runSkill: (name) =>
      json<{ taskId: string }>(`/api/skills/${encodeURIComponent(name)}/run`, {
        method: 'POST',
        body: '{}',
      }),
    schedules: () => json<SchedulesData>('/api/schedules'),
    setScheduleEnabled: (id, enabled) =>
      post(`/api/schedules/${encodeURIComponent(id)}/enabled`, { enabled }),
    runScheduleNow: (id) =>
      json<{ taskId: string }>(`/api/schedules/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        body: '{}',
      }),
    setWebhookEnabled: (id, enabled) =>
      post(`/api/webhooks/${encodeURIComponent(id)}/enabled`, { enabled }),
    // The server runs on this machine in its own time zone, so only the text and the phrase go.
    createSchedule: (s) =>
      json<{ id: string }>('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({ prompt: s.prompt, when: s.when }),
      }),
    brain: () => json<BrainData>('/api/brain'),
    updateNote: (id, text) => send('PUT', `/api/brain/${encodeURIComponent(id)}`, { text }),
    deleteNote: (id) => send('DELETE', `/api/brain/${encodeURIComponent(id)}`),
    ...notAvailable,
    settings: () => notYet<SettingsData>(),
    health: () => json<Health>('/api/health'),
    async testToken(token) {
      let res: Response;
      try {
        res = await doFetch(`${base}/api/tasks?limit=50`, {
          headers: { authorization: `Bearer ${token.trim()}` },
        });
      } catch {
        throw new Error('Remy could not be reached at this address.');
      }
      if (res.status === 401 || res.status === 403) throw new Error('That token was not accepted.');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The server did not accept that.');
      }
      const body = (await res.json().catch(() => ({}))) as { tasks?: TaskListItem[] };
      return { running: (body.tasks ?? []).filter((t) => t.status === 'running').length };
    },
    deleteNotes: () => notYet(),
    rotateToken: () => notYet(),
    testModels: () => notYet(),
    sendTestNotification: () => notYet(),
  };
  return api;
}

async function waitingCards(api: RemyApi, tasks: TaskListItem[]) {
  const waiting = tasks.filter((t) => t.status === 'waiting_approval').slice(0, 6);
  return Promise.all(waiting.map((t) => api.getTask(t.id)));
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Home from what the task routes already tell us. Machines, notes and the brain are not served yet. */
export function homeFromTasks(tasks: TaskListItem[], waiting: TaskView[]): HomeData {
  const running = tasks.filter((t) => t.status === 'running');
  const asks = waiting.length + tasks.filter((t) => t.status === 'waiting_user').length;
  const now = new Date();
  return {
    status: {
      running: running.length,
      machinesUp: null,
      notes: null,
      trust: 'ask',
      quiet: false,
      time: now.toTimeString().slice(0, 5),
    },
    briefing: {
      headline: asks
        ? `${plural(asks, 'thing')} need${asks === 1 ? 's' : ''} you.`
        : 'Nothing needs you.',
      rest: 'Everything else is on track.',
      stats: [
        `${plural(running.length, 'task')} running`,
        `${usd(tasks.reduce((s, t) => s + t.costUsd, 0))} spent`,
      ],
      asks: [],
    },
    satellites: [],
    needsYou: waiting.flatMap((v) =>
      v.pendingApproval
        ? [
            {
              taskId: v.taskId,
              kind: v.pendingApproval.risk.replaceAll('_', ' '),
              title: v.prompt,
              detail: v.pendingApproval.preview,
              approval: {
                callId: v.pendingApproval.callId,
                argsHash: v.pendingApproval.argsHash,
                approve: 'Approve',
                decline: 'Decline',
              },
            },
          ]
        : [],
    ),
    working: running.map((t) => ({
      taskId: t.id,
      title: t.prompt,
      state: 'working',
      done: 0,
      total: 0,
      line: `${usd(t.costUsd)} so far`,
    })),
    noticed: [],
    alert: null,
    brain: null,
  };
}

// The real adapter: fetch with a bearer token. Streaming uses fetch, not EventSource, because
// EventSource cannot send an Authorization header.

import { GENERIC, statusMessage } from '../lib/errors.ts';
import type {
  ApproveBody,
  BrainData,
  BrowserState,
  CatalogApp,
  ChatSent,
  ChatSummary,
  ChatView,
  ConnectionsData,
  ExtendBody,
  Health,
  HomeData,
  MachineInput,
  MachineTest,
  RegistrySearch,
  RemyApi,
  ReviewData,
  SchedulesData,
  SettingsData,
  SkillsData,
  StreamEvent,
  TaskListItem,
  TaskView,
  TrustLevel,
  Webhook,
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

export function createHttpApi(opts: {
  token: () => string | null;
  /** Called when the server says 401, so the app can ask for a token again. */
  onUnauthorized?: () => void;
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
    if (res.status === 401) opts.onUnauthorized?.();
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // The server's own sentence when it sent one; otherwise the status says what happened.
      throw new ApiError(res.status, body.error ?? statusMessage(res.status) ?? GENERIC);
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
    listChats: async () => (await json<{ chats: ChatSummary[] }>('/api/chats')).chats,
    getChat: (id) => json<ChatView>(`/api/chats/${encodeURIComponent(id)}`),
    sendMessage: (text, chatId, trust) =>
      json<ChatSent>('/api/chats/messages', {
        method: 'POST',
        body: JSON.stringify({ text, ...(chatId && { chatId }), ...(trust && { trust }) }),
      }),
    renameChat: (id, title) => send('PUT', `/api/chats/${encodeURIComponent(id)}`, { title }),
    deleteChat: (id) => send('DELETE', `/api/chats/${encodeURIComponent(id)}`),
    home: () => json<HomeData>('/api/home'),
    review(since) {
      const qs = since ? `?since=${encodeURIComponent(since)}` : '';
      return json<ReviewData>(`/api/review${qs}`);
    },
    // No server route yet.
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
    searchApps: (query) =>
      json<RegistrySearch>(`/api/connections/search?q=${encodeURIComponent(query)}`),
    // The key is never sent: the server uses the keys of the account Remy runs under.
    testMachine: (m) => json<MachineTest>('/api/machines/test', machineRequest(m)),
    removeMachine: (name) => send('DELETE', `/api/machines/${encodeURIComponent(name)}`),
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
    addWebhook: (input) =>
      json<Webhook>('/api/webhooks', { method: 'POST', body: JSON.stringify(input) }),
    removeWebhook: (name) => send('DELETE', `/api/webhooks/${encodeURIComponent(name)}`),
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
    settings: () => json<SettingsData>('/api/settings'),
    updateSettings: async (patch) => {
      await call('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
    },
    async speakAudio(text, signal) {
      const res = await call('/api/voice/speak', {
        method: 'POST',
        body: JSON.stringify({ text }),
        signal: signal ?? null,
      });
      return res.blob();
    },
    health: () => json<Health>('/api/health'),
    browserState: () => json<BrowserState>('/api/browser/state'),
    async browserFrame() {
      const res = await call('/api/browser/frame', { cache: 'no-store' });
      if (res.status === 204) return null;
      return URL.createObjectURL(await res.blob());
    },
    async testToken(token) {
      let res: Response;
      try {
        res = await doFetch(`${base}/api/tasks?limit=50`, {
          headers: { authorization: `Bearer ${token.trim()}` },
        });
      } catch {
        throw new Error(
          'Remy could not be reached at this address. Check the address and that Remy is running.',
        );
      }
      if (res.status === 401 || res.status === 403)
        throw new Error(
          'That token was not accepted. Check it for a missing character, then try again.',
        );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The server did not accept that.');
      }
      const body = (await res.json().catch(() => ({}))) as { tasks?: TaskListItem[] };
      return { running: (body.tasks ?? []).filter((t) => t.status === 'running').length };
    },
    deleteNotes: (confirm) =>
      json<{ deleted: number }>('/api/notes/delete-all', {
        method: 'POST',
        body: JSON.stringify({ confirm }),
      }),
    rotateToken: () => json<{ token: string }>('/api/token/rotate', { method: 'POST', body: '{}' }),
    testModels: () =>
      json<{ ok: boolean; detail: string }>('/api/models/test', { method: 'POST', body: '{}' }),
    sendTestNotification: () => post('/api/notifications/test'),
  };
  return api;
}

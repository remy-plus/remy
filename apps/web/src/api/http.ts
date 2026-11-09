// The real adapter: fetch with a bearer token. Streaming uses fetch, not EventSource, because
// EventSource cannot send an Authorization header.
import type {
  ApproveBody,
  ExtendBody,
  Health,
  HomeData,
  RemyApi,
  ReviewData,
  SettingsData,
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
const notAvailable = {
  connections: no,
  setPermission: no,
  disconnectApp: no,
  signInApp: no,
  appCatalog: no,
  connectApp: no,
  testMachine: no,
  addMachine: no,
  skills: no,
  setSkillEnabled: no,
  runSkill: no,
  resolveSuggestion: no,
  schedules: no,
  setScheduleEnabled: no,
  runScheduleNow: no,
  setWebhookEnabled: no,
  createSchedule: no,
  brain: no,
  updateNote: no,
  deleteNote: no,
} satisfies Partial<RemyApi>;

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
    home: () => json<HomeData>('/api/home'),
    review(since) {
      const qs = since ? `?since=${encodeURIComponent(since)}` : '';
      return json<ReviewData>(`/api/review${qs}`);
    },
    // No server route yet.
    async markDone(): Promise<void> {
      throw new ApiError(404, 'Marking a task done is not available from the server yet.');
    },
    // Mock-only for now: the server has no routes for connections, skills, schedules or the brain.
    ...notAvailable,
    settings: () => json<SettingsData>('/api/settings'),
    updateSettings: async (patch) => {
      await call('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
    },
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

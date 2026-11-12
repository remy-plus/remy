// `remy serve`: the Runtime over HTTP, for the web app and anything else on this machine. JSON in
// and out under /api, server-sent events for a task's events. Plain node:http, like the webhook
// listener, so there is no new dependency. Rules, all tested:
//  - everything except /api/health needs `Authorization: Bearer <token>`; the token is compared as
//    a hash in constant time; 5 wrong tries lock the address out for a minute;
//  - bodies are at most 64 KB and must arrive within 10 s (the event stream is exempt);
//  - an approval carries the argsHash the user saw; this server passes it on and never makes one;
//  - no CORS headers at all, and every /api answer is JSON or an event stream, never HTML; the web
//    app's static files are served for every other GET/HEAD path (serve-static.ts), without a token;
//  - nothing secret is logged: not the token, and request bodies are not logged.
// The event log is the source of truth: the stream just reads it, and after a restart the server
// picks up the tasks it started and `advance` recovers each one from its events.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import {
  type ConversationTurn,
  canStandingAllow,
  type EventStore,
  fold,
  isHelperTask,
  isTrustLevel,
  type RemyRuntime,
  type Risk,
  type RunOutcome,
  type StoredEvent,
  TaskBusyError,
  type TaskConfig,
  type TaskStatus,
  type TrustLevel,
} from '@remy/core';
import { z } from 'zod';
import type { ServeBind } from './serve-bind.ts';
import type { Mount } from './serve-mount.ts';
import { createStaticHandler } from './serve-static.ts';
import { listItem, type Redact, redactDeep, taskView } from './serve-view.ts';
import { bearer, safeEqual } from './webhook-auth.ts';
import { readBody } from './webhook-limits.ts';
import { createLockout, type Lockout } from './webhook-lockout.ts';
import { BODY_MAX_BYTES } from './webhook-payload.ts';
import { sha256Hex } from './webhook-token.ts';

export const PROMPT_MAX_CHARS = 20_000;
export const SERVE_BODY_MAX = BODY_MAX_BYTES; // 64 KB
export const SERVE_READ_TIMEOUT_MS = 10_000;
export const SERVE_BLOCK_MS = 60_000;
const PROMPT_MAX = PROMPT_MAX_CHARS;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;

/** What an extra API route sees: the method, the parts of the path after /api, and a body reader. */
export interface ApiCtx {
  method: string;
  /** The path after /api, split on '/': `/api/settings` is ['settings']. */
  parts: string[];
  url: URL;
  /** Reads and strictly parses the JSON body (64 KB at most); a bad body is a 400. */
  body<T>(schema: z.ZodType<T>, optional?: boolean): Promise<T>;
  /** Starts a task as POST /api/tasks does (monthly check included), with optional earlier turns. */
  startTask(
    prompt: string,
    trust?: TrustLevel,
    context?: ConversationTurn[],
    /** Start tainted, as when an earlier turn of the chat read untrusted content. */
    startTainted?: boolean,
  ): Promise<{ taskId: string }>;
}
export interface ApiResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
/** An extra route set: answers its own paths, and returns undefined for any other (then 404). */
export type ApiRoute = (ctx: ApiCtx) => Promise<ApiResult | undefined>;

export interface ServeDeps {
  /** Further API routes (home, review, settings, ...), tried after the token check. */
  routes?: ApiRoute[];
  store: EventStore;
  /** One runtime for every task this server runs. */
  runtime: RemyRuntime;
  home: string;
  version: string;
  /** The config a new task starts with (the same one `remy run` builds); `trust` overrides the saved level. */
  config(taskId: string, trust?: TrustLevel): TaskConfig;
  /** Runs before a task is created; throw an HttpError to refuse (the monthly cap). */
  beforeStart?: () => Promise<void>;
  /** The saved SHA-256 of the token, read on every request so a rotation takes effect at once. */
  tokenHash(): string | undefined;
  redact?: Redact;
  /** The built web app to serve at every non-API path (default: found next to the bundle or in apps/web/dist). */
  webRoot?: string;
  /** Saves "always allow" for a tool, as `remy approve --always` does. */
  alwaysAllow?(tool: string, risk: Risk): void;
  log(line: string): void;
  /** Who is recorded as having decided (default 'api'). */
  by?: string;
  lockout?: Lockout;
  /** How often a stream looks for new events (default 150 ms). */
  pollMs?: number;
  /** How long to wait before trying again when another runner holds a task (default 1 s). */
  busyMs?: number;
  /** How many times to try (default 40, which outlasts a crashed runner's lease). */
  busyTries?: number;
  /** Extra routes (connections, skills, schedules, brain), asked after the token check, in order. */
  mounts?: Mount[];
  /**
   * Host header values accepted besides loopback names (`host:port`, or a bare name for any port):
   * the bind address when it is not loopback, and REMY_SERVE_HOSTS (a Tailscale name, say).
   */
  allowedHosts?: string[];
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Host header rule (blocks DNS rebinding: a rebinding page's Host is the attacker's domain, never
 * one of these). Accepted: 127.0.0.1, localhost or [::1] with any port (any port so a Docker
 * published port still works), plus the entries of `allowed`. Anything else gets 421.
 */
export function hostAllowed(host: string | undefined, allowed: readonly string[] = []): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : (h.split(':')[0] as string);
  if (LOOPBACK_NAMES.has(name) && (h === name || /^:\d{1,5}$/.test(h.slice(name.length))))
    return true;
  return allowed.some((a) => {
    const x = a.toLowerCase();
    return h === x || (!/:\d+$/.test(x) && name === (x.startsWith('[') ? x : x.split(':')[0]));
  });
}

/** Minimal shape of `os.networkInterfaces()`, so tests can feed fixed values. */
export type InterfaceMap = Record<string, readonly { address: string }[] | undefined>;

/**
 * Host names this machine answers to, for the Host check. Bound to 0.0.0.0 or ::, that is every
 * interface address, the hostname and `hostname.local`; bound to one address, just that address.
 * Bare names mean any port (Docker may publish a different one). A rebinding page carries its own
 * domain in Host, never these. Read at listen time: addresses gained later need REMY_SERVE_HOSTS
 * or a restart.
 */
export function ownHosts(bindHost: string, interfaces: InterfaceMap, hostname: string): string[] {
  const fmt = (a: string): string | null => {
    const bare = a.split('%')[0] as string;
    if (!bare || /^fe80:/i.test(bare)) return null;
    return bare.includes(':') ? `[${bare}]` : bare;
  };
  const unspecified = ['0.0.0.0', '::', '::0'].includes(bindHost);
  if (!unspecified) {
    const one = fmt(bindHost);
    return one && !LOOPBACK_NAMES.has(one) ? [one.toLowerCase()] : [];
  }
  const out = new Set<string>();
  for (const list of Object.values(interfaces))
    for (const i of list ?? []) {
      const a = fmt(i.address);
      if (a) out.add(a.toLowerCase());
    }
  const h = hostname.trim().toLowerCase();
  if (h) {
    out.add(h);
    if (!h.includes('.')) out.add(`${h}.local`);
  }
  return [...out];
}

/** Cross-site browser traffic: a cross-site fetch, or an Origin that is not this server's own. */
function crossOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() !== (req.headers.host ?? '').toLowerCase();
  } catch {
    return true; // "null" and anything unparseable
  }
}

export interface ServeListening {
  server: Server;
  port: number;
  host: string;
  close(): Promise<void>;
}

const send = (
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) => {
  const raw = Buffer.isBuffer(body); // an image: the mount set its content-type
  const text = body === undefined || raw ? undefined : JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(text !== undefined && { 'content-type': 'application/json; charset=utf-8' }),
    ...headers,
  });
  res.end(raw ? body : text);
};

const TASK_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const STATUSES: TaskStatus[] = [
  'running',
  'waiting_approval',
  'waiting_user',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
];

const startBody = z
  .object({ prompt: z.string().trim().min(1).max(PROMPT_MAX), trust: z.string().optional() })
  .strict();
const approveBody = z
  .object({
    callId: z.string().min(1).max(200),
    argsHash: z.string().min(1).max(200),
    granted: z.boolean(),
    note: z.string().max(2000).optional(),
    always: z.boolean().optional(),
  })
  .strict();
const answerBody = z.object({ answer: z.string().min(1).max(PROMPT_MAX) }).strict();
const amount = z.number().finite().positive().max(1e9);
const extendBody = z
  .object({ steps: amount.optional(), costUsd: amount.optional(), wallMs: amount.optional() })
  .strict();

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const isFinal = (o: RunOutcome) =>
  o.status === 'succeeded' || o.status === 'failed' || o.status === 'cancelled';

export function createServe(deps: ServeDeps) {
  const redact: Redact = deps.redact ?? ((t) => t);
  const { store, runtime } = deps;
  const lockout = deps.lockout ?? createLockout(Date.now, SERVE_BLOCK_MS);
  const pollMs = deps.pollMs ?? 150;
  const busyMs = deps.busyMs ?? 1000;
  const busyTries = deps.busyTries ?? 40;
  const by = deps.by ?? 'api';
  const staticFiles = createStaticHandler(deps.webRoot === undefined ? {} : { root: deps.webRoot });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  let closed = false;
  const runs = new Map<string, Promise<void>>();
  const outcomes = new Map<string, RunOutcome | { status: 'error'; error: string }>();
  const streams = new Set<ServerResponse>();

  // ---- the tasks this server started and has not seen finish: resumed after a restart
  const trackedFile = join(deps.home, 'serve-tasks.json');
  const tracked = (): string[] => {
    try {
      const raw = JSON.parse(readFileSync(trackedFile, 'utf8')) as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const saveTracked = (ids: string[]) => {
    mkdirSync(deps.home, { recursive: true });
    const tmp = `${trackedFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(ids), { mode: 0o600 });
    renameSync(tmp, trackedFile);
  };
  const track = (id: string) => saveTracked([...new Set([...tracked(), id])]);
  const untrack = (id: string) => saveTracked(tracked().filter((x) => x !== id));

  /** Advances the task in the background unless it is already being advanced here. */
  function ensureRun(id: string): void {
    if (closed || runs.has(id)) return;
    const p = (async () => {
      for (let tries = 0; !closed; tries++) {
        try {
          // `advance` runs until the task needs the user, pauses or finishes, so one call is a whole run.
          const outcome = await runtime.advance(id);
          outcomes.set(id, outcome);
          if (isFinal(outcome)) untrack(id);
          return;
        } catch (e) {
          if (e instanceof TaskBusyError && tries < busyTries) {
            await sleep(busyMs);
            continue;
          }
          const error = redact(e instanceof Error ? e.message : String(e));
          outcomes.set(id, { status: 'error', error });
          deps.log(`serve run ${id} stopped: ${error}`);
          return;
        }
      }
    })().finally(() => runs.delete(id));
    runs.set(id, p);
  }

  /** Picks up the tasks a previous server left running. */
  async function resumeTracked(): Promise<void> {
    for (const id of tracked()) {
      const events = await store.read(id).catch(() => []);
      if (!events.length) {
        untrack(id);
        continue;
      }
      const s = fold(events);
      if (s.final) untrack(id);
      else if (s.status === 'running') ensureRun(id);
    }
  }

  /** Runs an action that needs the task's lease, trying again for a few seconds while a run holds it. */
  async function whenFree<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof TaskBusyError) {
          if (i < 15) {
            await sleep(200);
            continue;
          }
          throw new HttpError(409, 'The task is busy. Try again in a moment.');
        }
        throw new HttpError(
          409,
          redact(e instanceof Error ? e.message : 'The request could not be applied.'),
        );
      }
    }
  }

  const exists = async (id: string) => (await store.read(id, 1)).length > 0;

  async function bodyOf<T>(
    req: IncomingMessage,
    schema: z.ZodType<T>,
    optional = false,
  ): Promise<T> {
    const body = await readBody(req, SERVE_BODY_MAX, SERVE_READ_TIMEOUT_MS);
    if (!body.ok) throw new HttpError(body.status, `Request ${body.reason}.`);
    if (optional && !body.text.trim()) return schema.parse({});
    let json: unknown;
    try {
      json = JSON.parse(body.text);
    } catch {
      throw new HttpError(400, 'The body must be JSON.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new HttpError(400, 'The body does not match: check the field names and types.');
    return parsed.data;
  }

  // ---- routes
  async function listTasks(url: URL) {
    const status = url.searchParams.get('status') ?? undefined;
    if (status && !STATUSES.includes(status as TaskStatus))
      throw new HttpError(400, 'Unknown status.');
    const limit = Math.min(
      LIST_MAX,
      Math.max(1, Number(url.searchParams.get('limit')) || LIST_DEFAULT),
    );
    const all = (await store.listTasks(status ? { status: status as TaskStatus } : undefined))
      .filter((t) => !isHelperTask(t.taskId))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, limit);
    const items = [];
    for (const t of all) items.push(listItem(t, fold(await store.read(t.taskId)).costUsd, redact));
    return { tasks: items };
  }

  async function startTask(req: IncomingMessage) {
    const body = await bodyOf(req, startBody);
    if (body.trust !== undefined && !isTrustLevel(body.trust))
      throw new HttpError(400, 'trust must be ask, steady or away.');
    return beginTask(body.prompt, body.trust as TrustLevel | undefined);
  }

  /** Creates a task and starts it in the background; shared by POST /api/tasks and the mounts. */
  async function beginTask(
    prompt: string,
    trust?: TrustLevel,
    context?: ConversationTurn[],
    startTainted?: boolean,
  ) {
    await deps.beforeStart?.();
    const taskId = `task_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const base = deps.config(taskId, trust);
    const config = {
      ...base,
      ...(context?.length && { context }),
      ...(startTainted && { startTainted: true }),
    };
    await store.createTask(taskId, prompt, config);
    track(taskId);
    ensureRun(taskId);
    return { taskId };
  }

  async function getTask(id: string) {
    const events = await store.read(id);
    if (!events.length) throw new HttpError(404, 'There is no such task.');
    return taskView(fold(events), redact, { running: runs.has(id), outcome: outcomes.get(id) });
  }

  async function approve(id: string, req: IncomingMessage) {
    const b = await bodyOf(req, approveBody);
    const s = fold(await store.read(id));
    const card = s.pendingApproval?.callId === b.callId ? s.pendingApproval : undefined;
    if (b.always && b.granted) {
      const risk = card?.risk ?? s.calls[b.callId]?.risk;
      if (!risk || !canStandingAllow(risk))
        throw new HttpError(400, 'This kind of action asks every time.');
      // The card's hash must match before anything is saved, so a wrong hash saves nothing.
      if (card && card.argsHash !== b.argsHash)
        throw new HttpError(409, 'approval is for different arguments');
      if (!deps.alwaysAllow) throw new HttpError(400, 'Always allow is not available here.');
    }
    await whenFree(() =>
      runtime.approve(
        id,
        b.callId,
        b.argsHash,
        b.granted,
        by,
        b.granted ? undefined : b.note,
        b.granted ? b.always === true : undefined,
      ),
    );
    try {
      if (b.always && b.granted)
        deps.alwaysAllow?.(
          s.calls[b.callId]?.tool ?? '',
          (card?.risk ?? s.calls[b.callId]?.risk) as Risk,
        );
    } finally {
      ensureRun(id);
    }
    return { ok: true };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const from = req.socket.remoteAddress ?? 'unknown';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const reply = (status: number, body?: unknown, headers?: Record<string, string>) => {
      deps.log(`serve ${method} ${path.slice(0, 80)} ${status} from ${from}`);
      send(res, status, body, headers);
    };

    if (!hostAllowed(req.headers.host, deps.allowedHosts))
      return reply(421, { error: 'This address is not one Remy answers on.' });
    if (path === '/api') return reply(404);
    if (!path.startsWith('/api/')) return staticFiles(req, res); // the web app: no token, no API
    if (path === '/api/health') {
      if (method !== 'GET') return reply(405, undefined, { allow: 'GET' });
      return reply(200, { ok: true, version: deps.version });
    }

    // Neither of these counts toward the lockout: a cross-site page must not be able to lock the
    // person out of their own server by sending requests that carry no token.
    if (crossOrigin(req)) return reply(403, { error: 'Cross-site requests are not accepted.' });
    if (method === 'OPTIONS') return reply(405, undefined, { allow: 'GET, POST, PUT, DELETE' });

    if (lockout.blocked(from))
      return reply(
        429,
        { error: 'Too many wrong tokens. Try again in a minute.' },
        { 'retry-after': '60' },
      );
    const given = bearer(req.headers.authorization);
    const hash = deps.tokenHash();
    if (given === undefined || hash === undefined || !safeEqual(sha256Hex(given), hash)) {
      // Only a token that was offered and is wrong counts; no Authorization header is just a 401.
      if (req.headers.authorization !== undefined) lockout.fail(from);
      return reply(
        401,
        { error: 'A valid bearer token is required.' },
        { 'www-authenticate': 'Bearer' },
      );
    }

    try {
      const parts = path.split('/').slice(2); // after /api
      const ctx: ApiCtx = {
        method,
        parts,
        url,
        body: (schema, optional) => bodyOf(req, schema, optional),
        startTask: beginTask,
      };
      for (const route of deps.routes ?? []) {
        const r = await route(ctx);
        if (r) return reply(r.status, r.body, r.headers);
      }
      for (const mount of deps.mounts ?? []) {
        const m = await mount({ req, method, url, parts, startTask: beginTask });
        if (m)
          return reply(
            m.status,
            m.body && !Buffer.isBuffer(m.body) ? redactDeep(m.body, redact) : m.body,
            m.headers,
          );
      }
      const [head, id, action] = parts;
      if (head !== 'tasks' || parts.length > 3) return reply(404);
      if (id === undefined || id === '') {
        if (parts.length !== 1 && !(parts.length === 2 && id === '')) return reply(404);
        if (method === 'GET') return reply(200, await listTasks(url));
        if (method === 'POST') return reply(201, await startTask(req));
        return reply(405, undefined, { allow: 'GET, POST' });
      }
      if (!TASK_ID.test(id)) return reply(404);

      if (action === undefined) {
        if (method !== 'GET') return reply(405, undefined, { allow: 'GET' });
        return reply(200, await getTask(id));
      }
      if (action === 'stream') {
        if (method !== 'GET') return reply(405, undefined, { allow: 'GET' });
        return await stream(req, res, url, id, from);
      }
      if (!['approve', 'answer', 'cancel', 'extend'].includes(action)) return reply(404);
      if (method !== 'POST') return reply(405, undefined, { allow: 'POST' });
      if (!(await exists(id))) throw new HttpError(404, 'There is no such task.');

      if (action === 'approve') return reply(200, await approve(id, req));
      if (action === 'answer') {
        const b = await bodyOf(req, answerBody);
        await whenFree(() => runtime.answer(id, b.answer));
        ensureRun(id);
        return reply(200, { ok: true });
      }
      if (action === 'cancel') {
        await bodyOf(req, z.object({}).passthrough(), true);
        await whenFree(() => runtime.cancel(id, by));
        untrack(id);
        return reply(200, { ok: true });
      }
      const b = await bodyOf(req, extendBody, true);
      await whenFree(() => runtime.extend(id, b, by));
      ensureRun(id);
      return reply(200, { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message });
      deps.log(`serve error: ${redact(e instanceof Error ? e.message : String(e))}`);
      if (res.headersSent) return void res.destroy();
      return reply(500, { error: 'Something went wrong.' });
    }
  }

  /** Replays the task's events, then follows new ones until it finishes or the client leaves. */
  async function stream(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    id: string,
    from: string,
  ) {
    const header = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId');
    const last = typeof header === 'string' && /^\d{1,9}$/.test(header) ? Number(header) : 0;
    let next = last + 1;
    let pending: StoredEvent[] | undefined = await store.read(id, next);
    // A client that reconnects after the last event of a finished task gets an empty, closed stream.
    let over = false;
    if (!pending.length) {
      const all = await store.read(id, 1);
      if (!all.length) {
        deps.log(`serve GET stream 404 from ${from}`);
        return send(res, 404, { error: 'There is no such task.' });
      }
      over = all.some((e) => e.event.type === 'task.finished');
    }
    deps.log(`serve GET stream 200 from ${from} after ${last}`);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    res.on('error', () => {});
    streams.add(res);
    let gone = false;
    res.on('close', () => {
      gone = true;
      streams.delete(res);
    });
    res.write('retry: 2000\n\n');
    if (over) return void res.end();
    let quiet = 0;
    while (!gone && !closed) {
      const events: StoredEvent[] = pending ?? (await store.read(id, next));
      pending = undefined;
      for (const e of events) {
        const data = JSON.stringify(redactDeep({ seq: e.seq, at: e.at, event: e.event }, redact));
        res.write(`id: ${e.seq}\ndata: ${data}\n\n`);
        next = e.seq + 1;
        if (e.event.type === 'task.finished') {
          res.end();
          return;
        }
      }
      if (events.length) {
        quiet = 0;
        continue;
      }
      await sleep(pollMs);
      quiet += pollMs;
      if (quiet >= 15_000) {
        res.write(': keepalive\n\n');
        quiet = 0;
      }
    }
    if (!res.writableEnded) res.end();
  }

  return { handle, ensureRun, resumeTracked, streams, stop: () => (closed = true), runs };
}

/** Starts listening. `bind` has already been checked by `resolveServeBind`. */
export async function listenServe(deps: ServeDeps, bind: ServeBind): Promise<ServeListening> {
  const allowedHosts = [...(deps.allowedHosts ?? [])];
  for (const h of (process.env.REMY_SERVE_HOSTS ?? '').split(','))
    if (h.trim()) allowedHosts.push(h.trim());
  const serve = createServe({ ...deps, allowedHosts });
  const server = createServer((req, res) => {
    serve.handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });
  // Bodies are small, so the whole request must arrive quickly. Streams are responses, not requests.
  server.requestTimeout = SERVE_READ_TIMEOUT_MS;
  server.headersTimeout = SERVE_READ_TIMEOUT_MS;
  server.maxHeadersCount = 50;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(bind.port, bind.host, () => resolve());
  });
  if (!LOOPBACK_NAMES.has(bind.host) && bind.host !== '::1')
    allowedHosts.push(...ownHosts(bind.host, networkInterfaces(), osHostname()));
  void serve
    .resumeTracked()
    .catch((e) =>
      deps.log(`serve could not resume tasks: ${e instanceof Error ? e.message : String(e)}`),
    );
  return {
    server,
    port: (server.address() as AddressInfo).port,
    host: bind.host,
    close: () =>
      new Promise<void>((done) => {
        serve.stop();
        for (const s of serve.streams) s.end();
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

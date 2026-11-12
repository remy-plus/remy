// The webhook listener. Every rule is enforced here, in this order: a blocked address is refused,
// then the path and method are checked, then the token (a wrong token and an unknown hook look the
// same), then the run limits, then the body. The answer is 202 and a run id, never task output.
// Nothing secret is logged: not the token, and for payloads only a size and a short hash.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authorized } from './webhook-auth.ts';
import { type Bind, LOOPBACK } from './webhook-bind.ts';
import {
  createRunGate,
  MAX_RUNNING,
  READ_TIMEOUT_MS,
  type RunGate,
  readBody,
} from './webhook-limits.ts';
import { createLockout, type Lockout } from './webhook-lockout.ts';
import { BODY_MAX_BYTES, payloadFacts } from './webhook-payload.ts';
import { type Hook, NAME_RE } from './webhook-store.ts';

export interface HandlerDeps {
  /** Looked up on every request, so a hook added or removed takes effect at once. */
  hook(name: string): Hook | undefined;
  sharedToken(): string;
  /** Starts the run and returns its task id. Gets the raw body; cleaning happens there. */
  start(hook: Hook, payload: string): Promise<string>;
  /** Whether a run is still going or waiting for the user. */
  isActive(runId: string): Promise<boolean>;
  log(line: string): void;
  lockout?: Lockout;
  gate?: RunGate;
  readTimeoutMs?: number;
  maxBodyBytes?: number;
  maxRunning?: number;
}

const send = (
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  res.writeHead(status, {
    connection: 'close',
    'cache-control': 'no-store',
    ...(text !== undefined && { 'content-type': 'application/json' }),
    ...headers,
  });
  res.end(text);
};

export function createWebhookHandler(deps: HandlerDeps) {
  const lockout = deps.lockout ?? createLockout();
  const maxRunning = deps.maxRunning ?? MAX_RUNNING;
  const gate = deps.gate ?? createRunGate();
  const active = new Set<string>();
  let starting = 0;

  const runningCount = async () => {
    for (const id of [...active])
      if (!(await deps.isActive(id).catch(() => true))) active.delete(id);
    return active.size + starting;
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const from = req.socket.remoteAddress ?? 'unknown';
    const secret = deps.sharedToken();
    const log = (status: number, name: string, extra = '') =>
      deps.log(`webhook ${name} ${status} from ${from}${extra}`.replaceAll(secret, '[token]'));
    const reply = (status: number, name = '-', extra = '', headers?: Record<string, string>) => {
      log(status, name, extra);
      send(res, status, undefined, headers);
    };

    if (lockout.blocked(from)) return reply(429);
    const path = (req.url ?? '').split('?')[0] ?? '';
    const m = /^\/hook\/([^/]+)$/.exec(path);
    if (!m || !NAME_RE.test(m[1] as string)) return reply(404);
    const name = m[1] as string;
    if (req.method !== 'POST') return reply(405, '-', '', { allow: 'POST' });

    const hook = deps.hook(name);
    if (!authorized(req.headers.authorization, hook, secret)) {
      // Only a token that was offered and is wrong counts toward the lockout.
      if (req.headers.authorization !== undefined) lockout.fail(from);
      return reply(401);
    }
    if (!hook) return reply(404);

    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const json = type === 'application/json';
    if (!json && !type.startsWith('text/')) return reply(415, name);

    if ((await runningCount()) >= maxRunning) return reply(429, name, ' (too many running)');
    const reservation = gate.reserve(name);
    if (reservation !== 'ok') return reply(429, name, ` (${reservation})`);
    starting++;
    try {
      const body = await readBody(
        req,
        deps.maxBodyBytes ?? BODY_MAX_BYTES,
        deps.readTimeoutMs ?? READ_TIMEOUT_MS,
      );
      if (!body.ok) {
        gate.release(name);
        reply(body.status, name, ` (${body.reason})`);
        if (body.status !== 413) req.destroy();
        return;
      }
      const facts = payloadFacts(body.text);
      if (json && body.text.trim()) {
        try {
          JSON.parse(body.text);
        } catch {
          gate.release(name);
          return reply(400, name, ` ${facts.bytes} bytes sha256:${facts.hash}`);
        }
      }
      try {
        const run = await deps.start(hook, body.text);
        active.add(run);
        log(202, name, ` ${facts.bytes} bytes sha256:${facts.hash} run ${run}`);
        send(res, 202, { run });
      } catch (e) {
        gate.release(name);
        reply(
          500,
          name,
          ` ${facts.bytes} bytes sha256:${facts.hash} did not start: ${e instanceof Error ? e.message : 'error'}`,
        );
      }
    } finally {
      starting--;
    }
  };
}

export interface Listening {
  server: Server;
  port: number;
  host: string;
  close(): Promise<void>;
}

/** Starts listening. `bind` has already been checked by `resolveBind`. */
export function listenWebhook(
  deps: HandlerDeps,
  bind: Bind = { host: LOOPBACK, port: 0 },
): Promise<Listening> {
  const handler = createWebhookHandler(deps);
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });
  server.requestTimeout = (deps.readTimeoutMs ?? READ_TIMEOUT_MS) + 1000;
  server.headersTimeout = READ_TIMEOUT_MS;
  server.maxHeadersCount = 50;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(bind.port, bind.host, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        host: bind.host,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

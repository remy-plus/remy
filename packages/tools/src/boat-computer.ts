// A Boat cloud computer (boat.dev) as Remy's own computer, on the person's own Boat key.
// Remy never holds a Boat account. One sandbox is found or made on first use and reused after.
// API facts come from the public docs (https://docs.boat.dev/api/v1.md); see docs/computers.md.
import { randomUUID } from 'node:crypto';
import { type Computer, ComputerSetupError } from './computer.ts';

export type BoatSize = 'small' | 'default' | 'large' | 'xlarge';
export const BOAT_SIZES: readonly BoatSize[] = ['small', 'default', 'large', 'xlarge'];

export interface BoatConfig {
  kind: 'boat';
  name: string;
  /** Machine size (Boat's `type`). Default `default` (4 vCPU, 8 GB). There is no region choice. */
  size?: BoatSize;
  /** Seconds idle before Boat stops the machine (disk kept). Default 3600; a trial allows 7200. */
  idleStopSeconds?: number;
}

export interface BoatDeps {
  /** Read the person's key when it is needed. Never called at construction. */
  getKey: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const BASE = 'https://boat.dev/api/v1';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const READY_WAIT_MS = 180_000;
const READY = new Set(['ready', 'idle', 'running']);
const PREPARING = new Set(['init', 'provisioning', 'provisioned', 'cloning', 'archiving']);

export const BOAT_NO_KEY =
  'Boat needs your own API key. Create one at boat.dev (boat api-key create), then run remy search key boat, or set BOAT_API_KEY. Boat costs money after its 7-day trial and runs in EU regions only.';

interface Sandbox {
  id: string;
  state: string;
}

class BoatHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function boatComputer(cfg: BoatConfig, deps: BoatDeps): Computer {
  if (!NAME_RE.test(cfg.name)) throw new Error(`Invalid name: ${cfg.name}`);
  const size = cfg.size ?? 'default';
  if (!BOAT_SIZES.includes(size)) throw new Error(`Invalid size: ${String(size)}`);
  const ttl = cfg.idleStopSeconds ?? 3600;
  if (!(Number.isInteger(ttl) && ttl >= 60 && ttl <= 2_592_000))
    throw new Error(`Invalid idleStopSeconds: ${ttl}`);
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = deps.baseUrl ?? BASE;
  const label = `remy-${cfg.name}`;
  let sandboxId: string | undefined;
  let key: string | undefined;

  const redact = (s: string) => (key ? s.split(key).join('[key]') : s);

  const api = async (
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; ms?: number },
  ): Promise<Record<string, unknown>> => {
    if (!key) {
      key = (await deps.getKey())?.trim();
      if (!key) throw new ComputerSetupError(BOAT_NO_KEY);
    }
    const timeout = AbortSignal.timeout(opts.ms ?? 30_000);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          accept: 'application/json',
          ...(opts.body !== undefined && { 'content-type': 'application/json' }),
          ...opts.headers,
        },
        ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new BoatHttpError(0, 'network', 'Could not reach Boat. Check your connection.', false);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return data;
    const code = String(data.code ?? (data.error as { code?: string } | undefined)?.code ?? '');
    const msg = redact(String(data.message ?? '')).slice(0, 200);
    const req = data.requestId ? ` (request ${redact(String(data.requestId)).slice(0, 60)})` : '';
    const details = (data.error as { details?: { retryable?: boolean } } | undefined)?.details;
    const retryAfter = res.headers.get('retry-after');
    const wait = retryAfter ? ` Try again in about ${retryAfter} seconds.` : '';
    const plain: Record<number, string> = {
      401: 'Boat refused the key. Check it with remy search key boat.',
      402: 'Your Boat account needs billing: the trial or included time is used up. Add a payment method at boat.dev.',
      403: `Boat does not allow that on your plan${msg ? `: ${msg}` : ''}.`,
      404: 'Boat could not find the computer.',
      429: `Boat is at a start or concurrency limit.${wait}`,
      503: `Boat has no free machine right now.${wait}`,
    };
    const text =
      plain[res.status] ??
      (res.status >= 500
        ? `Boat had a server problem (HTTP ${res.status}).${req}`
        : `Boat refused the request (HTTP ${res.status}${code ? `, ${code}` : ''})${msg ? `: ${msg}` : ''}.${req}`);
    throw new BoatHttpError(res.status, code, text, details?.retryable === true);
  };

  const sandboxOf = (d: Record<string, unknown>): Sandbox | undefined => {
    const s = d.sandbox as Partial<Sandbox> | undefined;
    return s?.id && s.state ? { id: s.id, state: s.state } : undefined;
  };

  const waitReady = async (id: string, signal?: AbortSignal) => {
    const until = Date.now() + READY_WAIT_MS;
    for (;;) {
      const s = sandboxOf(await api('GET', `/sandboxes/${encodeURIComponent(id)}`, { signal }));
      if (!s) throw new ComputerSetupError('Boat answered in a shape Remy does not know.');
      if (READY.has(s.state)) return;
      if (s.state === 'archived') {
        await api('POST', `/sandboxes/${encodeURIComponent(id)}/resume`, {
          body: { ttlSeconds: ttl },
          signal,
        });
      } else if (!PREPARING.has(s.state)) {
        throw new ComputerSetupError(
          `The Boat computer is in state "${s.state}" and cannot run commands.`,
        );
      }
      if (Date.now() > until)
        throw new ComputerSetupError('The Boat computer did not become ready in time.');
      await sleep(2_000);
    }
  };

  const ensure = async (signal?: AbortSignal) => {
    if (!sandboxId) {
      // Look for the one a past run made, so a restart never leaves a second billable machine.
      const states = 'provisioning,provisioned,cloning,ready,idle,running,archived';
      const found = await api(
        'GET',
        `/sandboxes?label=${encodeURIComponent(`remy-computer=${label}`)}&state=${encodeURIComponent(states)}&limit=1`,
        { signal },
      );
      const hit = Array.isArray(found.sandboxes)
        ? (found.sandboxes[0] as Partial<Sandbox> | undefined)
        : undefined;
      if (hit?.id) sandboxId = hit.id;
      else {
        const made = await api('POST', '/sandboxes', {
          body: { name: label, type: size, ttlSeconds: ttl, labels: { 'remy-computer': label } },
          headers: { 'idempotency-key': randomUUID() },
          signal,
          ms: 60_000,
        });
        const s = sandboxOf(made);
        if (!s) throw new ComputerSetupError('Boat answered in a shape Remy does not know.');
        sandboxId = s.id;
      }
    }
    await waitReady(sandboxId, signal);
    return sandboxId;
  };

  const setup = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof BoatHttpError) throw new ComputerSetupError(e.message);
      throw e;
    }
  };

  return {
    name: cfg.name,
    where: `Boat cloud computer ${label} (${size}, EU)`,
    async run(command, opts) {
      const id = await setup(() => ensure(opts.signal));
      const body = {
        command,
        timeoutSeconds: Math.min(600, Math.max(1, Math.ceil(opts.timeoutMs / 1000))),
      };
      const send = () =>
        api('POST', `/sandboxes/${encodeURIComponent(id)}/commands`, {
          body,
          signal: opts.signal,
          ms: opts.timeoutMs + 20_000,
        });
      let d: Record<string, unknown>;
      try {
        try {
          d = await send();
        } catch (e) {
          // A 409 means the command never started (the machine was not ready): wait, send once more.
          if (!(e instanceof BoatHttpError && e.status === 409)) throw e;
          await ensure(opts.signal);
          d = await send();
        }
      } catch (e) {
        if (e instanceof BoatHttpError && (e.status === 502 || e.status === 0)) {
          return {
            exitCode: 255,
            stdout: '',
            stderr: e.retryable
              ? 'Boat could not start the command. It did not run.'
              : 'Boat could not confirm the command finished. It may still be running on the computer; check before running it again.',
          };
        }
        if (e instanceof BoatHttpError) throw new ComputerSetupError(e.message);
        throw e;
      }
      const exit = typeof d.exitCode === 'number' ? d.exitCode : d.timedOut ? 124 : 255;
      const cut =
        d.stdoutTruncated || d.stderrTruncated ? '\n[Boat cut the output at its limit]' : '';
      return {
        exitCode: exit,
        stdout: redact(String(d.stdout ?? '')) + cut,
        stderr: redact(String(d.stderr ?? '')) + (d.oomKilled ? '\n[ran out of memory]' : ''),
        ...(d.timedOut === true && { timedOut: true }),
      };
    },
  };
}

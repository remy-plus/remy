// Request limits for webhooks: body size and read time, one run per hook per 10 seconds, and at most
// 3 webhook runs going at once.
import type { IncomingMessage } from 'node:http';
import { BODY_MAX_BYTES } from './webhook-payload.ts';

export const READ_TIMEOUT_MS = 10_000;
export const HOOK_GAP_MS = 10_000;
export const MAX_RUNNING = 3;

export type BodyResult =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 408 | 413; reason: string };

/** Reads the body up to `max` bytes within `timeoutMs`. Stops reading as soon as a limit is hit. */
export function readBody(
  req: IncomingMessage,
  max = BODY_MAX_BYTES,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<BodyResult> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      resolve({ ok: false, status: 413, reason: 'body too large' });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (r: BodyResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, status: 408, reason: 'read timed out' }),
      timeoutMs,
    );
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) return finish({ ok: false, status: 413, reason: 'body too large' });
      chunks.push(c);
    });
    req.on('end', () => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => finish({ ok: false, status: 400, reason: 'read failed' }));
    req.on('aborted', () => finish({ ok: false, status: 400, reason: 'read aborted' }));
  });
}

export type Reservation = 'ok' | 'too_soon';

export interface RunGate {
  /** Checks and takes the hook's slot in one step, so two requests at once cannot both pass. */
  reserve(hook: string): Reservation;
  /** Gives the slot back when the run did not start. */
  release(hook: string): void;
}

export function createRunGate(now: () => number = Date.now, gapMs = HOOK_GAP_MS): RunGate {
  const last = new Map<string, number>();
  return {
    reserve(hook) {
      const t = now();
      const before = last.get(hook);
      if (before !== undefined && t - before < gapMs) return 'too_soon';
      last.set(hook, t);
      return 'ok';
    },
    release(hook) {
      last.delete(hook);
    },
  };
}

// How the route files (connections, skills, schedules, brain) plug into `remy serve`. Each file
// exports a `Mount`: given the request after the bearer token was checked, it answers or returns
// undefined to say the path is not its own. The server redacts every body it sends, so a mount
// cannot leak a secret it forgot about, but mounts must not put one there to begin with.
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { readBody } from './webhook-limits.ts';
import { BODY_MAX_BYTES } from './webhook-payload.ts';

export interface MountRequest {
  req: IncomingMessage;
  method: string;
  url: URL;
  /** The path after /api, split on '/'. */
  parts: string[];
  /** Starts a task exactly as POST /api/tasks does. */
  startTask(prompt: string): Promise<{ taskId: string }>;
}

export interface MountReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Mount = (r: MountRequest) => Promise<MountReply | undefined>;

/** A plain refusal: the message is shown to the person, so it says what to do. */
export class HttpFail extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ids in a path: the same rule the task routes use. */
export const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export const ok = (body: unknown = { ok: true }, status = 200): MountReply => ({ status, body });
export const methodNotAllowed = (...allow: string[]): MountReply => ({
  status: 405,
  headers: { allow: allow.join(', ') },
});

/** Reads a JSON body (64 KB at most, 10 s), parsed strictly by `schema`. */
export async function jsonBody<T>(
  req: IncomingMessage,
  schema: z.ZodType<T>,
  optional = false,
): Promise<T> {
  const body = await readBody(req, BODY_MAX_BYTES, 10_000);
  if (!body.ok) throw new HttpFail(body.status, `Request ${body.reason}.`);
  if (optional && !body.text.trim()) return schema.parse({});
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    throw new HttpFail(400, 'The body must be JSON.');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new HttpFail(400, 'The body does not match: check the field names and types.');
  return parsed.data;
}

/** The raw JSON object of a body, for a check that must run before strict parsing. */
export async function rawJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return jsonBody(req, z.record(z.string(), z.unknown()));
}

/** Turns a thrown HttpFail into its reply. Anything else is rethrown for the server's 500. */
export function guard(mount: Mount): Mount {
  return async (r) => {
    try {
      return await mount(r);
    } catch (e) {
      if (e instanceof HttpFail) return { status: e.status, body: { error: e.message } };
      throw e;
    }
  };
}

/** An id from the path, or a 404. */
export function idOf(raw: string | undefined): string {
  if (raw === undefined || !ID_RE.test(raw)) throw new HttpFail(404, 'There is no such item.');
  return raw;
}

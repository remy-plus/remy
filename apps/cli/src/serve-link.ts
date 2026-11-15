// `remy serve link`: a fresh one-time sign-in link for a server that is already running, with no
// new network route. The command makes the code in its own process and leaves the server only the
// code's SHA-256 hash, in an owner-only file in REMY_HOME that the server picks up and deletes. The
// code itself is never written to a file or a log: it goes from this process to the terminal.
//
// Anyone who can write a file into REMY_HOME as the same user can already add a session to
// serve-sessions.json, so this opens nothing new. A file made by another user, with group or world
// permissions, a link in its place, or an old one is ignored and deleted.
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { phoneUrls } from './serve-bind.ts';
import { NETWORK_WARNING, phoneBlock } from './serve-phone.ts';
import { type SignInCodes, signInLinkAt } from './serve-signin.ts';
import { newToken, sha256Hex } from './webhook-token.ts';

export const LINK_REQUEST_FILE = 'serve-link-request.json';
export const LISTENING_FILE = 'serve-listening.json';
/** A request older than this is stale and ignored. */
export const LINK_REQUEST_MAX_AGE_MS = 60_000;
/** How often the server looks for a request. */
export const LINK_POLL_MS = 500;
/** How long `remy serve link` waits for the server to pick its request up. */
export const LINK_WAIT_MS = 5_000;
const MAX_REQUEST_BYTES = 2_000;

const requestShape = z
  .object({
    hashes: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(4),
    at: z.number(),
  })
  .strict();

const listeningShape = z
  .object({ pid: z.number().int(), host: z.string().min(1).max(255), port: z.number().int() })
  .strict();

const owned = (home: string, name: string) => join(home, name);

function writePrivate(file: string, text: string): void {
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// ---- the running server says where it listens

/** Writes where the server listens (no secret in it) and returns a function that removes it. */
export function announceListening(
  home: string,
  at: { host: string; port: number },
  pid: number = process.pid,
): () => void {
  mkdirSync(home, { recursive: true });
  const file = owned(home, LISTENING_FILE);
  const tmp = `${file}.${pid}.tmp`;
  writePrivate(tmp, `${JSON.stringify({ pid, host: at.host, port: at.port })}\n`);
  linkReplace(tmp, file);
  return () => {
    try {
      const now = JSON.parse(readFileSync(file, 'utf8')) as { pid?: number };
      if (now.pid === pid) rmSync(file, { force: true }); // not another server's file
    } catch {}
  };
}

function linkReplace(tmp: string, file: string): void {
  rmSync(file, { force: true });
  linkSync(tmp, file);
  rmSync(tmp, { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Where a running server in this home listens, or undefined when none is running. */
export function readListening(
  home: string,
  isAlive: (pid: number) => boolean = alive,
): { host: string; port: number } | undefined {
  try {
    const l = listeningShape.parse(JSON.parse(readFileSync(owned(home, LISTENING_FILE), 'utf8')));
    return isAlive(l.pid) ? { host: l.host, port: l.port } : undefined;
  } catch {
    return undefined;
  }
}

// ---- the server's side: pick up a request

export interface LinkWatchOptions {
  now?: () => number;
  pollMs?: number;
  /** The user id files must belong to (default: this process's). Tests pass another. */
  uid?: number | undefined;
  log?: (line: string) => void;
}

/**
 * Looks once for a request. 'adopted' when its hashes became codes, 'ignored' when a file was there
 * and was refused (deleted either way), 'none' when there was nothing.
 */
export function takeLinkRequest(
  home: string,
  codes: SignInCodes,
  opts: LinkWatchOptions = {},
): 'none' | 'adopted' | 'ignored' {
  const file = owned(home, LINK_REQUEST_FILE);
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(file);
  } catch {
    return 'none';
  }
  const uid = 'uid' in opts ? opts.uid : process.getuid?.();
  const fine =
    info.isFile() &&
    info.size <= MAX_REQUEST_BYTES &&
    (uid === undefined || info.uid === uid) &&
    (process.platform === 'win32' || (info.mode & 0o077) === 0);
  let request: z.infer<typeof requestShape> | undefined;
  if (fine) {
    try {
      request = requestShape.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {}
  }
  rmSync(file, { force: true });
  const now = (opts.now ?? Date.now)();
  if (!request || Math.abs(now - request.at) > LINK_REQUEST_MAX_AGE_MS) {
    opts.log?.('serve: ignored a sign-in link request that was not valid');
    return 'ignored';
  }
  for (const h of request.hashes) codes.adopt(h);
  return 'adopted';
}

/** Checks for a request every half second until stopped. Never keeps the process alive. */
export function watchLinkRequests(
  home: string,
  codes: SignInCodes,
  opts: LinkWatchOptions = {},
): () => void {
  const timer = setInterval(() => {
    try {
      takeLinkRequest(home, codes, opts);
    } catch {
      // A request that cannot be read is tried again or removed next time; the server goes on.
    }
  }, opts.pollMs ?? LINK_POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

// ---- the command's side

export interface MakeLinksOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
  pollMs?: number;
  isAlive?: (pid: number) => boolean;
}

/**
 * Makes `count` codes, hands their hashes to the running server and waits until it has taken them.
 * Returns the codes (only in memory). Throws a plain error when another request is waiting or the
 * server does not answer.
 */
export async function requestCodes(
  home: string,
  count: number,
  opts: MakeLinksOptions = {},
): Promise<string[]> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const file = owned(home, LINK_REQUEST_FILE);
  // An old request nobody took (the server stopped) must not block a new one.
  try {
    if (now() - lstatSync(file).mtimeMs > LINK_REQUEST_MAX_AGE_MS) rmSync(file, { force: true });
  } catch {}
  const codes = Array.from({ length: Math.min(count, 4) }, () => newToken());
  const tmp = `${file}.${process.pid}.tmp`;
  writePrivate(tmp, `${JSON.stringify({ hashes: codes.map(sha256Hex), at: now() })}\n`);
  try {
    linkSync(tmp, file); // exclusive: fails when a request is already waiting
  } catch {
    throw new Error('Another sign-in link is being made. Wait a moment, then try again.');
  } finally {
    rmSync(tmp, { force: true });
  }
  const end = now() + (opts.waitMs ?? LINK_WAIT_MS);
  for (;;) {
    try {
      lstatSync(file);
    } catch {
      return codes; // the server took it and deleted it
    }
    if (now() > end) {
      rmSync(file, { force: true });
      throw new Error(
        'Remy did not answer. Check that remy serve is still running, then try again.',
      );
    }
    await sleep(opts.pollMs ?? 100);
  }
}

const NOT_RUNNING =
  'Remy is not running here. Start it with remy serve, then run this again in another terminal.';

/** Turns `--url` into an origin, or throws a plain error. */
export function originFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password)
      return u.origin;
  } catch {}
  throw new Error('Use --url like http://192.168.1.20:7790 (the address your phone opens).');
}

/**
 * The lines `remy serve link` prints: a fresh one-time link for the running server, as a QR code
 * for each address a phone can open (or the address given with `url`), or as a plain link when the
 * server listens on this computer only.
 */
export async function linkLines(
  home: string,
  opts: MakeLinksOptions & {
    url?: string;
    color: boolean;
    interfaces: Parameters<typeof phoneUrls>[2];
  },
): Promise<string[]> {
  const listening = readListening(home, opts.isAlive);
  if (!listening) throw new Error(NOT_RUNNING);
  let origins = opts.url
    ? [originFromUrl(opts.url)]
    : phoneUrls(listening.host, listening.port, opts.interfaces);
  const local = origins.length === 0;
  if (local)
    origins = [
      `http://${hostName(['0.0.0.0', '::'].includes(listening.host) ? '127.0.0.1' : listening.host)}:${listening.port}`,
    ];
  const codes = await requestCodes(home, origins.length, opts);
  const lines: string[] = [];
  origins.forEach((origin, i) => {
    const code = codes[i] as string;
    if (local)
      lines.push(
        'Open this link to sign in on this computer (it works once, for 10 minutes):',
        signInLinkAt(origin, code),
      );
    else lines.push(...phoneBlock(origin, code, opts.color));
  });
  if (!local) lines.push('', NETWORK_WARNING);
  return lines;
}

const hostName = (host: string) =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

// Terminal manners, kept out of the components: ask the terminal what it can do before using
// it, stay quiet when it cannot, and tell a person who looked away that Remy is waiting.
// Ink 8 already wraps frames in synchronized-output markers (on any TTY outside CI) and has
// `usePaste` for bracketed paste. What it lacks, and this file adds, is the gate on the
// terminal's own answer, focus tracking, notifications, and a place for stray output to go.
import type { Theme } from './theme.ts';

export type Env = Record<string, string | undefined>;

/** Synchronized output: begin and end of one atomic frame. */
const ESC = '\x1b';
export const SYNC_MARKERS = new RegExp(`${ESC}\\[\\?2026[hl]`, 'g');
const DECRQM_REPLY = new RegExp(`${ESC}\\[\\?2026;(\\d)\\$y`);
const OSC11_REPLY = new RegExp(
  `${ESC}\\]11;rgb:([0-9a-f]{1,4})/([0-9a-f]{1,4})/([0-9a-f]{1,4})(?:\\x07|${ESC}\\\\)`,
  'i',
);
const DA1_REPLY = new RegExp(`${ESC}\\[\\?[0-9;]*c`);
const FOCUS_REPORT = new RegExp(`${ESC}\\[([IO])`, 'g');
const FOCUS_INPUT = new RegExp(`^(${ESC})?\\[[IO]$`);

const DECRQM_SYNC = '\x1b[?2026$p';
const OSC11_QUERY = '\x1b]11;?\x1b\\';
const DA1 = '\x1b[c';
const FOCUS_ON = '\x1b[?1004h';
const FOCUS_OFF = '\x1b[?1004l';
const BEL = '\x07';

export interface ProbeResult {
  /** The terminal answered the DECRQM query for synchronized output with "supported". */
  sync: boolean;
  /** From the OSC 11 answer: undefined when the terminal did not say. */
  background?: 'dark' | 'light';
}

/** Reads what the terminal said back. `done` once the device-attributes sentinel arrived. */
export function parseProbeReply(buf: string): ProbeResult & { done: boolean } {
  const mode = DECRQM_REPLY.exec(buf);
  // 1 set, 2 reset, 3 permanently set: the mode exists. 0 unknown and 4 permanently reset: it does not.
  const sync = mode ? ['1', '2', '3'].includes(mode[1] as string) : false;
  const bg = OSC11_REPLY.exec(buf);
  let background: ProbeResult['background'];
  if (bg) {
    const c = [bg[1], bg[2], bg[3]].map((h) => {
      const s = h as string;
      return Number.parseInt(s, 16) / (16 ** s.length - 1);
    }) as [number, number, number];
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    background = lum > 0.5 ? 'light' : 'dark';
  }
  return { sync, ...(background && { background }), done: DA1_REPLY.test(buf) };
}

/** The slice of a TTY the probe and notifier use, so tests can stand in for it. */
export interface TtyIn {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(raw: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', fn: (chunk: Buffer | string) => void): unknown;
  off(event: 'data', fn: (chunk: Buffer | string) => void): unknown;
}
export interface TtyOut {
  isTTY?: boolean;
  write(text: string): unknown;
}

/** Whether to talk to the terminal at all: a real TTY on both ends, not `dumb`. */
export const interactive = (env: Env, stdin: TtyIn, stdout: TtyOut) =>
  Boolean(stdin.isTTY && stdout.isTTY && stdin.setRawMode && env.TERM !== 'dumb');

const unset = (v: string | undefined) => v === undefined || v === '' || v === '0' || v === 'false';

/**
 * Asks the terminal once, before the screen opens: does it do synchronized output, and is its
 * background light or dark. The device-attributes query goes last; every terminal answers it,
 * so its reply means the others were answered or will not be. `timeoutMs` bounds the wait.
 */
export async function probeTerminal(
  env: Env,
  stdin: TtyIn,
  stdout: TtyOut,
  timeoutMs = 150,
): Promise<ProbeResult> {
  if (!interactive(env, stdin, stdout)) return { sync: false };
  // With colours off the background does not matter, so it is not asked.
  const askBackground = unset(env.NO_COLOR) && env.FORCE_COLOR !== '0';
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode?.(true);
  stdin.resume();
  return await new Promise<ProbeResult>((resolve) => {
    let buf = '';
    const finish = () => {
      clearTimeout(timer);
      stdin.off('data', onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      const { done: _, ...result } = parseProbeReply(buf);
      resolve(result);
    };
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString('latin1');
      if (parseProbeReply(buf).done) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    stdin.on('data', onData);
    stdout.write(DECRQM_SYNC + (askBackground ? OSC11_QUERY : '') + DA1);
  });
}

/**
 * A stdout that drops Ink's synchronized-output markers unless the terminal said it supports
 * them. Everything else passes through untouched.
 */
export function gateSync<T extends object & { write: (...a: never[]) => unknown }>(
  stdout: T,
  supported: boolean,
): T {
  if (supported) return stdout;
  return new Proxy(stdout, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === 'write')
        return (chunk: unknown, ...rest: unknown[]) =>
          (target.write as (...a: unknown[]) => unknown)(
            typeof chunk === 'string' ? chunk.replace(SYNC_MARKERS, '') : chunk,
            ...rest,
          );
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export type Attention = 'waiting_approval' | 'waiting_user';

/** What to emit to get a person's attention, or '' when notifications are off. */
export function notifySequence(env: Env, why: Attention): string {
  const mode = env.REMY_NOTIFY?.toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') return '';
  const text = why === 'waiting_approval' ? 'Remy needs your approval' : 'Remy has a question';
  // OSC 9 is a desktop notification where it exists; everywhere else the bell is the signal.
  const osc9 = /^(iTerm\.app|WezTerm|ghostty)$/.test(env.TERM_PROGRAM ?? '');
  return mode === 'bell' || !osc9 ? BEL : `\x1b]9;${text}${BEL}`;
}

/** Splits `\x1b[I` (focus in) and `\x1b[O` (focus out) out of the stream; the last one wins. */
export function parseFocus(chunk: string): boolean | undefined {
  const all = [...chunk.matchAll(FOCUS_REPORT)];
  const last = all[all.length - 1];
  return last ? last[1] === 'I' : undefined;
}

/** Input Ink may report for a focus report; the chat must not type it into the prompt. */
export const isFocusReport = (input: string) => FOCUS_INPUT.test(input);

export interface Notifier {
  /** Call when the chat starts waiting on the person. Rings only if the terminal is unfocused. */
  attention(why: Attention): void;
  stop(): void;
}

/** Tracks terminal focus (when it reports it) and rings for attention while unfocused. */
export function createNotifier(env: Env, stdin: TtyIn, stdout: TtyOut): Notifier {
  if (/^(off|0|false)$/i.test(env.REMY_NOTIFY ?? '') || !interactive(env, stdin, stdout))
    return { attention() {}, stop() {} };
  let focused = true; // until the terminal says otherwise; a terminal that never reports never rings
  const onData = (chunk: Buffer | string) => {
    const f = parseFocus(chunk.toString('latin1'));
    if (f !== undefined) focused = f;
  };
  stdin.on('data', onData);
  stdout.write(FOCUS_ON);
  return {
    attention(why) {
      if (focused) return;
      const seq = notifySequence(env, why);
      if (seq) stdout.write(seq);
    },
    stop() {
      stdin.off('data', onData);
      stdout.write(FOCUS_OFF);
    },
  };
}

type Stray = (stream: 'stdout' | 'stderr', text: string) => void;

/**
 * While the screen is open, anything else written with `console.*` or to stderr would land in
 * the middle of a frame. It goes to `sink` (the --debug log) instead. Returns the undo.
 */
export function captureStray(sink: Stray | undefined): () => void {
  const consoleMethods = ['log', 'info', 'debug', 'warn', 'error'] as const;
  const saved = consoleMethods.map((m) => [m, console[m]] as const);
  const errWrite = process.stderr.write;
  const text = (args: unknown[]) =>
    args.map((a) => (typeof a === 'string' ? a : (JSON.stringify(a) ?? String(a)))).join(' ');
  for (const m of consoleMethods)
    console[m] = (...args: unknown[]) =>
      sink?.(m === 'warn' || m === 'error' ? 'stderr' : 'stdout', text(args));
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    sink?.('stderr', typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const cb = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    cb?.();
    return true;
  }) as typeof process.stderr.write;
  return () => {
    for (const [m, fn] of saved) console[m] = fn;
    process.stderr.write = errWrite;
  };
}

/** The theme for a probed background; the same theme when the terminal did not say. */
export const themeFor = (theme: Theme, probe: ProbeResult): Theme =>
  probe.background ? theme.withBackground(probe.background) : theme;

// Frame batching for streamed text: many tiny deltas become one state update per frame.

/** Default frame length: about 60 updates a second. */
export const FRAME_MS = 16;
/** Frame length right after a keypress, so typing and cursor moves show at once. */
export const INPUT_FRAME_MS = 4;
/** How long after a keypress the short frame length applies. */
export const INPUT_BOOST_MS = 50;

/** Something that can say the output is backed up, and when to try again. */
export interface Gate {
  /** True while the terminal is not keeping up. */
  busy(): boolean;
  /** Calls `fn` once, when the backlog may have cleared (a drain or a short timer). */
  whenClear(fn: () => void): void;
}

export interface BatcherOptions {
  /** Frame length for `boostMs` after `boost()`. Applies only when `ms` is longer. */
  fastMs?: number;
  boostMs?: number;
  /** While busy, a due frame waits and its text keeps collecting, so the latest frame wins. */
  gate?: Gate;
  /** The clock, for tests. */
  now?: () => number;
}

export interface TextBatcher {
  /** Adds a delta. `onTick` fires once per frame while text is waiting. */
  push(delta: string): void;
  /** Returns everything waiting, in order, and cancels the timer. */
  take(): string;
  /** A key was pressed: frames come faster for a moment. */
  boost(): void;
  /** True while text is waiting. */
  readonly pending: boolean;
}

/**
 * Collects deltas. With `ms` of 0 (or less) there is no waiting: `push` calls `onTick`
 * straight away and the caller `take()`s the delta inside it. A busy gate holds a due frame
 * back; nothing is dropped, because the text stays in the buffer until someone `take()`s it.
 */
export function createTextBatcher(
  ms: number,
  onTick: () => void,
  opts: BatcherOptions = {},
): TextBatcher {
  const { fastMs = INPUT_FRAME_MS, boostMs = INPUT_BOOST_MS, gate, now = Date.now } = opts;
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;
  let boostUntil = 0;
  /** Bumped by take(), so a frame held for the gate does nothing once its text is gone. */
  let epoch = 0;
  let held = false;

  const frameMs = () => (ms > fastMs && now() < boostUntil ? fastMs : ms);

  const fire = () => {
    timer = undefined;
    if (!buf) return;
    if (gate?.busy()) {
      if (held) return;
      held = true;
      const mine = epoch;
      gate.whenClear(() => {
        held = false;
        if (mine === epoch && buf && !timer) fire();
      });
      return;
    }
    onTick();
  };
  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    dueAt = now() + delay;
    timer = setTimeout(fire, delay);
  };

  return {
    push(delta) {
      if (!delta) return;
      buf += delta;
      if (ms <= 0) return onTick();
      if (!timer && !held) schedule(frameMs());
    },
    boost() {
      boostUntil = now() + boostMs;
      // A frame already waiting on the long clock moves up; one held for the gate stays held.
      if (timer && ms > fastMs && dueAt - now() > fastMs) schedule(fastMs);
    },
    take() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      epoch++;
      held = false;
      const out = buf;
      buf = '';
      return out;
    },
    get pending() {
      return buf.length > 0;
    },
  };
}

/** The slice of stdout the gate reads, so tests can stand in for it. */
export interface GateOut {
  writableLength?: number;
  writableNeedDrain?: boolean;
  once(event: 'drain', fn: () => void): unknown;
  off?(event: 'drain', fn: () => void): unknown;
}

/** Output counts as backed up above this many queued bytes. */
export const BACKLOG_BYTES = 16 * 1024;
/** If no drain comes, look again after this long. */
export const BACKLOG_RETRY_MS = 8;

/** A gate on a writable stream: busy while its queue is long or it asked for a drain. */
export function stdoutGate(out: GateOut, limit = BACKLOG_BYTES, retryMs = BACKLOG_RETRY_MS): Gate {
  return {
    busy: () => (out.writableLength ?? 0) > limit || out.writableNeedDrain === true,
    whenClear(fn) {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        out.off?.('drain', go);
        fn();
      };
      out.once('drain', go);
      const t = setTimeout(go, retryMs);
    },
  };
}

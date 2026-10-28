// Frame batching for streamed text: many tiny deltas become one state update per frame.

/** Default frame length: about 60 updates a second. */
export const FRAME_MS = 16;

export interface TextBatcher {
  /** Adds a delta. `onTick` fires once per frame while text is waiting. */
  push(delta: string): void;
  /** Returns everything waiting, in order, and cancels the timer. */
  take(): string;
  /** True while text is waiting. */
  readonly pending: boolean;
}

/**
 * Collects deltas. With `ms` of 0 (or less) there is no waiting: `push` calls `onTick`
 * straight away and the caller `take()`s the delta inside it.
 */
export function createTextBatcher(ms: number, onTick: () => void): TextBatcher {
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(delta) {
      if (!delta) return;
      buf += delta;
      if (ms <= 0) return onTick();
      timer ??= setTimeout(() => {
        timer = undefined;
        onTick();
      }, ms);
    },
    take() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const out = buf;
      buf = '';
      return out;
    },
    get pending() {
      return buf.length > 0;
    },
  };
}

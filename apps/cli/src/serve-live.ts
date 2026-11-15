// Words on their way: what a model is writing right now, for the screens following that task.
// The event log stays the source of truth. These pieces are never stored, a screen that
// reconnects gets the stored events and, if the model is mid-sentence, what has been written so
// far; and the final answer always comes from the stored events.
import type { LiveEvent } from '@remy/core';

/** The wire form, one per SSE `data:` line (no `id:`, so Last-Event-ID never counts them). */
export type LiveMessage =
  | { live: { kind: 'start' } }
  | { live: { kind: 'text' | 'answer'; delta: string } }
  /** Everything written so far, replacing what the screen holds (a reconnect, or a redaction). */
  | { live: { kind: 'set'; of: 'text' | 'answer'; text: string } };

export interface LiveBus {
  publish(taskId: string, e: LiveEvent): void;
  /** Calls `fn` for each piece until the returned function is called. Replays what is written so far. */
  subscribe(taskId: string, fn: (e: LiveEvent) => void): () => void;
  /** The task's run ended: forget its buffer. */
  clear(taskId: string): void;
}

/** Most text kept per task for a reconnecting screen, and most tasks kept at once. */
const KEEP_CHARS = 60_000;
const KEEP_TASKS = 64;

interface Current {
  kind: 'text' | 'answer';
  text: string;
}

export function createLiveBus(): LiveBus {
  const current = new Map<string, Current>();
  const listeners = new Map<string, Set<(e: LiveEvent) => void>>();
  return {
    publish(taskId, e) {
      if (e.kind === 'start') {
        current.delete(taskId);
      } else {
        const c = current.get(taskId);
        if (c && c.kind === e.kind) c.text = (c.text + e.delta).slice(-KEEP_CHARS);
        else current.set(taskId, { kind: e.kind, text: e.delta.slice(-KEEP_CHARS) });
        while (current.size > KEEP_TASKS) {
          const oldest = current.keys().next().value;
          if (oldest === undefined) break;
          current.delete(oldest);
        }
      }
      for (const fn of listeners.get(taskId) ?? []) {
        try {
          fn(e);
        } catch {
          // A screen that cannot take a piece never stops the model.
        }
      }
    },
    subscribe(taskId, fn) {
      const set = listeners.get(taskId) ?? new Set<(e: LiveEvent) => void>();
      listeners.set(taskId, set);
      set.add(fn);
      const c = current.get(taskId);
      if (c?.text) fn({ kind: c.kind, delta: c.text });
      return () => {
        set.delete(fn);
        if (!set.size) listeners.delete(taskId);
      };
    },
    clear(taskId) {
      current.delete(taskId);
    },
  };
}

/**
 * Turns live pieces into wire messages for one screen, with the redaction the stored events get.
 * A secret can be split across two pieces, so the text so far is redacted as a whole; if that
 * changes what was already sent, the screen is told to replace its text.
 */
export function liveWriter(redact: (text: string) => string, send: (m: LiveMessage) => void) {
  let kind: 'text' | 'answer' | undefined;
  let acc = '';
  let sent = '';
  return (e: LiveEvent) => {
    if (e.kind === 'start') {
      kind = undefined;
      acc = '';
      sent = '';
      send({ live: { kind: 'start' } });
      return;
    }
    if (kind !== e.kind) {
      kind = e.kind;
      acc = '';
      sent = '';
    }
    acc += e.delta;
    const now = redact(acc);
    if (now.startsWith(sent)) {
      const delta = now.slice(sent.length);
      sent = now;
      if (delta) send({ live: { kind: e.kind, delta } });
    } else {
      sent = now;
      send({ live: { kind: 'set', of: e.kind, text: now } });
    }
  };
}

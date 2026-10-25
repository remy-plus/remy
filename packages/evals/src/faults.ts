// Fault injection: a store that dies at a chosen event, and tools that fail transiently.
import type { Event, EventStore, Tool } from '@remy/core';
import type { Fault } from './types.ts';

export class Crash extends Error {
  override name = 'Crash';
}

type CrashFault = Extract<Fault, { kind: 'crash' }>;

export interface CrashingStore {
  store: EventStore;
  /** Faults that have fired. */
  readonly crashes: () => number;
  /** Call once the "process" has been replaced: the next runtime may release leases again. */
  revive: () => void;
}

/**
 * Each crash fault fires once, at the first append holding a matching event. While dead, the old
 * runtime can't release its lease, so the harness has to wait it out like a real restart would.
 */
export function crashingStore(inner: EventStore, faults: Fault[]): CrashingStore {
  const pending = faults.filter((f): f is CrashFault => f.kind === 'crash');
  const toolOf = new Map<string, string>();
  let dead = false;
  let fired = 0;

  const matches = (f: CrashFault, events: Event[]) =>
    events.some(
      (e) =>
        e.type === f.event &&
        (!f.tool || ('callId' in e && !!e.callId && toolOf.get(e.callId) === f.tool)),
    );

  const store = new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'releaseLease')
        return (...a: Parameters<EventStore['releaseLease']>) =>
          dead ? Promise.resolve() : target.releaseLease(...a);
      if (prop !== 'append') return Reflect.get(target, prop, recv);
      return async (...args: Parameters<EventStore['append']>) => {
        const events = args[2];
        for (const e of events)
          if (e.type === 'model.responded') for (const c of e.calls) toolOf.set(c.callId, c.tool);
        const i = pending.findIndex((f) => matches(f, events));
        const fault = i >= 0 ? pending[i] : undefined;
        if (fault && fault.when === 'before') {
          pending.splice(i, 1);
          dead = true;
          fired += 1;
          throw new Crash(`crash before ${fault.event}`);
        }
        const seq = await target.append(...args);
        if (fault) {
          pending.splice(i, 1);
          dead = true;
          fired += 1;
          throw new Crash(`crash after ${fault.event}`);
        }
        return seq;
      };
    },
  });
  return {
    store,
    crashes: () => fired,
    revive: () => {
      dead = false;
    },
  };
}

/** Wraps tools so the named ones fail with a retryable error for their first `times` executions. */
export function withTransient(tools: Tool[], faults: Fault[]): Tool[] {
  const left = new Map<string, number>();
  for (const f of faults) if (f.kind === 'transient') left.set(f.tool, f.times);
  return tools.map((t) => {
    if (!left.has(t.name)) return t;
    return {
      ...t,
      async execute(args, ctx) {
        const n = left.get(t.name) ?? 0;
        if (n > 0) {
          left.set(t.name, n - 1);
          return {
            ok: false,
            error: '503 Service Unavailable (injected)',
            retryable: true,
            phase: 'before_effect',
          };
        }
        return t.execute(args, ctx);
      },
    };
  });
}

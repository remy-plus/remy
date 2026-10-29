// Memory recall that keeps the prompt cache warm. The system prompt never changes; the notes picked
// for a user message go in front of that message, computed once and then reused word for word, so
// a later `remember` or a new turn only changes what comes after it.
import type { ModelClient } from '@remy/core';
import { type MemoryEntry, memoryQuery, notesBlock, REMEMBER_HINT } from '@remy/tools';

export interface RecallOptions {
  /** Read on every call: personalising can be switched off mid-session. */
  enabled: () => boolean;
  notes: () => MemoryEntry[];
  /** Whether the remember and forget tools are registered. */
  hasTools: boolean;
}

export function withRecall(inner: ModelClient, o: RecallOptions): ModelClient {
  // Keyed by the message text: the same message gets the same notes in every later request.
  const frozen = new Map<string, string>();
  return {
    get id() {
      return inner.id;
    },
    get caps() {
      return inner.caps;
    },
    complete(req, ...a) {
      if (!o.enabled()) return inner.complete(req, ...a);
      const last = req.messages.findLastIndex((m) => m.role === 'user');
      const messages = req.messages.map((m, i) => {
        if (m.role !== 'user') return m;
        const text = m.content ?? '';
        let block = frozen.get(text);
        if (block === undefined && i === last) {
          block = notesBlock(o.notes(), memoryQuery(req.messages.slice(0, i + 1)));
          frozen.set(text, block);
        }
        return block ? { ...m, content: `${block}\n\n${text}` } : m;
      });
      const system = o.hasTools ? `${req.system}\n\n${REMEMBER_HINT}` : req.system;
      return inner.complete({ ...req, system, messages }, ...a);
    },
  };
}

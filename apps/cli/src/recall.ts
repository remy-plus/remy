// Per-message context that keeps the prompt cache warm: the situation (time, background tasks,
// connections) and the memory notes picked for a user message go in front of that message,
// computed once and then reused word for word, so a later `remember` or a new turn only changes
// what comes after it. The system prompt never changes.
import type { ModelClient } from '@remy/core';
import { type MemoryEntry, memoryQuery, notesBlock, REMEMBER_HINT } from '@remy/tools';

export interface RecallOptions {
  /** Read on every call: personalising can be switched off mid-session. */
  enabled: () => boolean;
  notes: () => MemoryEntry[];
  /** Whether the remember and forget tools are registered. */
  hasTools: boolean;
  /** The situation block for a new user message; sent whether or not personalising is on. */
  situation?: () => Promise<string>;
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
    async complete(req, ...a) {
      const on = o.enabled();
      if (!on && !o.situation) return inner.complete(req, ...a);
      const last = req.messages.findLastIndex((m) => m.role === 'user');
      const lastText = req.messages[last]?.content;
      if (last >= 0 && typeof lastText === 'string' && !frozen.has(lastText)) {
        const parts = [
          o.situation ? await o.situation() : '',
          on ? notesBlock(o.notes(), memoryQuery(req.messages.slice(0, last + 1))) : '',
        ];
        frozen.set(lastText, parts.filter(Boolean).join('\n\n'));
      }
      const messages = req.messages.map((m) => {
        if (m.role !== 'user') return m;
        const block = frozen.get(m.content);
        return block ? { ...m, content: `${block}\n\n${m.content}` } : m;
      });
      const system = on && o.hasTools ? `${req.system}\n\n${REMEMBER_HINT}` : req.system;
      return inner.complete({ ...req, system, messages }, ...a);
    },
  };
}

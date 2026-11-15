// Per-message context that keeps the prompt cache warm: the situation (time, background tasks,
// connections), the skills that fit and the memory notes picked for a user message go in front of that message,
// computed once and then reused word for word, so a later `remember` or a new turn only changes
// what comes after it. The system prompt never changes.
import type { ModelClient } from '@remy/core';
import {
  HOWTO_NOTE,
  HOWTO_NOTE_MARK,
  looksLikeCorrection,
  type MemoryEntry,
  memoryQuery,
  notesBlock,
  REMEMBER_HINT,
  type SemanticSource,
} from '@remy/tools';

/** Where the time went before a message's first model call (the web app's "speed" line). */
export interface PrepTiming {
  /** Everything from the message arriving to the request leaving. */
  totalMs: number;
  situationMs: number;
  memoryMs: number;
}

export interface RecallOptions {
  /** Read on every call: personalising can be switched off mid-session. */
  enabled: () => boolean;
  notes: () => MemoryEntry[];
  /** Vectors for ranking, when the user turned embeddings on; undefined results mean local ranking. */
  semantic?: SemanticSource;
  /** Whether the remember and forget tools are registered. */
  hasTools: boolean;
  /** The situation block for a new user message; sent whether or not personalising is on. */
  situation?: () => Promise<string>;
  /** The skills that fit the user's recent messages; sent whether or not personalising is on. */
  skills?: (query: string) => string;
  /** Whether a correction may carry the how-to note: personalising on and save_howto registered. */
  howto?: () => boolean;
  /** Told how long a new message's context took to build; off unless asked for. */
  onPrep?: (t: PrepTiming) => void;
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
      if (!on && !o.situation && !o.skills && !o.howto) return inner.complete(req, ...a);
      const last = req.messages.findLastIndex((m) => m.role === 'user');
      const lastText = req.messages[last]?.content;
      if (last >= 0 && typeof lastText === 'string' && !frozen.has(lastText)) {
        const t0 = performance.now();
        const query = memoryQuery(req.messages.slice(0, last + 1));
        const notes = on ? o.notes() : [];
        // Ranking by meaning (which may call an embedding service) and the situation do not
        // depend on each other, so they run side by side instead of one after the other.
        const timed = async <T>(work: Promise<T>) => {
          const t = performance.now();
          const value = await work;
          return { value, ms: Math.round(performance.now() - t) };
        };
        const [semR, sitR] = await Promise.all([
          timed(Promise.resolve(on && o.semantic ? o.semantic(notes, query) : undefined)),
          timed(Promise.resolve(o.situation ? o.situation() : '')),
        ]);
        const sem = semR.value;
        const earlier = req.messages.slice(0, last);
        // A correction needs an answer to correct, and a task gets the note once.
        const correcting =
          o.howto?.() === true &&
          looksLikeCorrection(lastText, {
            hasPriorAnswer: earlier.some((m) => m.role === 'assistant' && m.content !== 'Noted.'),
          }) &&
          !earlier.some(
            (m) => m.role === 'user' && (frozen.get(m.content) ?? '').includes(HOWTO_NOTE_MARK),
          );
        const parts = [
          correcting ? HOWTO_NOTE : '',
          sitR.value,
          o.skills ? o.skills(query) : '',
          on ? notesBlock(notes, query, sem) : '',
        ];
        frozen.set(lastText, parts.filter(Boolean).join('\n\n'));
        o.onPrep?.({
          totalMs: Math.round(performance.now() - t0),
          situationMs: sitR.ms,
          memoryMs: semR.ms,
        });
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

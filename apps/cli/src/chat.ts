// The chat controller: drives the runtime for a conversation and exposes plain state.
// It knows nothing about Ink; the components in chat-ui.ts only render `getState()`.
import {
  type ApprovalRequest,
  type ConversationTurn,
  type EventStore,
  ModelError,
  type RemyRuntime,
  type RunOutcome,
  type StoredEvent,
  TaskBusyError,
  type TaskConfig,
} from '@remy/core';
import { truncate } from './format.ts';

export type ToolState = 'waiting_approval' | 'running' | 'ok' | 'failed' | 'denied';

export interface ToolLine {
  callId: string;
  tool: string;
  args: string;
  state: ToolState;
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'doing' | 'done';
}

/** Things that stay on screen once they are said. */
export type Item =
  | { kind: 'user'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'tools'; lines: ToolLine[] }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

export type Phase = 'idle' | 'running' | 'waiting_approval' | 'waiting_user';

export interface ChatState {
  phase: Phase;
  items: Item[];
  /** The assistant text streaming in right now. */
  streaming: string;
  /** True from the start of a model call until its reply arrives. */
  thinking: boolean;
  tools: ToolLine[];
  plan?: PlanStep[];
  step: number;
  approval?: ApprovalRequest;
  question?: string;
  taskId?: string;
  /** Total spend of this conversation. */
  costUsd: number;
  /** Set while a failed model call waits to be retried. */
  retrying?: string;
  /** The user asked to quit with /exit. */
  wantsExit?: boolean;
}

export interface RuntimeHooks {
  onEvent: (e: StoredEvent) => void;
  onText: (delta: string) => void;
  onModelStart: () => void;
}

export interface ChatDeps {
  /** Builds the runtime with the controller's hooks wired in. */
  runtime: (hooks: RuntimeHooks) => RemyRuntime;
  /** The config for a new task; `context` carries the earlier turns. */
  config: (context: ConversationTurn[]) => TaskConfig;
  /** Lets go of a task's lease so `remy resume` can take it. */
  release: (taskId: string) => Promise<void>;
}

export interface Chat {
  getState(): ChatState;
  subscribe(fn: () => void): () => void;
  /** A line from the user: a new message, an answer to a question, or a /command. */
  submit(text: string): Promise<void>;
  /** Answers the pending approval. */
  approve(granted: boolean): Promise<void>;
  /** Stops the running task. It stays resumable. */
  interrupt(): Promise<void>;
  /** The messages the user has sent, oldest first, for recall. */
  history(): string[];
}

/** Earlier turns sent as context are capped so a long chat does not outgrow the model. */
export const MAX_CONTEXT_TURNS = 20;

export const HELP_TEXT = [
  'Type a message and press Enter. Remy answers, and asks before anything it should not do alone.',
  '',
  'Keys',
  '  Enter     send',
  '  Up        bring back your last message',
  '  Esc       clear the input',
  '  Ctrl+C    stop the running task (resume it later); on an empty prompt, quit',
  '  Ctrl+D    quit',
  '  y / n     approve or deny when Remy asks',
  '',
  'Commands',
  '  /help     this list',
  '  /new      start a fresh conversation',
  '  /exit     quit',
].join('\n');

/** Tools that are plumbing, not work worth a status line. */
const QUIET_TOOLS = new Set(['finish', 'ask_user', 'update_plan']);

const STATUSES = new Set(['pending', 'doing', 'done']);

/** Reads `update_plan` args: `{ steps: {text, status}[] }`. Returns undefined for anything else. */
export function parsePlan(args: unknown): PlanStep[] | undefined {
  const steps = (args as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return undefined;
  const out: PlanStep[] = [];
  for (const s of steps as { text?: unknown; status?: unknown }[]) {
    if (typeof s?.text !== 'string') continue;
    out.push({
      text: s.text,
      status: STATUSES.has(s.status as string) ? (s.status as PlanStep['status']) : 'pending',
    });
  }
  return out.length ? out : undefined;
}

export function summarizeArgs(args: unknown): string {
  if (args === null || typeof args !== 'object')
    return args === undefined ? '' : truncate(String(args), 60);
  return truncate(
    Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `${k}=${truncate(typeof v === 'string' ? v : JSON.stringify(v), 40)}`)
      .join(' '),
    80,
  );
}

/** One calm line: what happened, then what to do next. */
export function friendlyError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).trim().replace(/\s+/g, ' ');
  if (e instanceof ModelError)
    return `The model did not answer: ${truncate(msg, 160)}. Check your connection and key, then send your message again.`;
  if (e instanceof TaskBusyError)
    return 'Another run holds this task. Wait a few seconds, then send your message again.';
  return `${truncate(msg, 200)}. Send your message again, or run /help.`;
}

const initial = (): ChatState => ({
  phase: 'idle',
  items: [],
  streaming: '',
  thinking: false,
  tools: [],
  step: 0,
  costUsd: 0,
});

export function createChat(deps: ChatDeps): Chat {
  let s = initial();
  let turns: ConversationTurn[] = [];
  const sent: string[] = [];
  const listeners = new Set<() => void>();
  /** Bumped by interrupt and /new, so a stopped run's late callbacks are ignored. */
  let gen = 0;
  let current: { id: string; prompt: string } | undefined;
  /** True while a run is live; false once it was interrupted, so late callbacks are ignored. */
  let running = false;
  const calls = new Map<string, { tool: string; args: unknown }>();

  const set = (patch: Partial<ChatState>) => {
    s = { ...s, ...patch };
    for (const fn of listeners) fn();
  };
  const push = (item: Item) => set({ items: [...s.items, item] });
  const setTool = (callId: string, state: ToolState) => {
    if (!s.tools.some((t) => t.callId === callId)) return;
    set({ tools: s.tools.map((t) => (t.callId === callId ? { ...t, state } : t)) });
  };

  function onEvent(e: StoredEvent) {
    const ev = e.event;
    switch (ev.type) {
      case 'model.responded': {
        const added: ToolLine[] = [];
        let plan = s.plan;
        for (const c of ev.calls) {
          calls.set(c.callId, { tool: c.tool, args: c.args });
          if (c.tool === 'update_plan') plan = parsePlan(c.args) ?? plan;
          if (!QUIET_TOOLS.has(c.tool))
            added.push({
              callId: c.callId,
              tool: c.tool,
              args: summarizeArgs(c.args),
              state: 'running',
            });
        }
        set({
          step: ev.step,
          thinking: false,
          retrying: undefined,
          // Text that comes with tool calls is narration, not the answer.
          streaming: '',
          costUsd: s.costUsd + ev.costUsd,
          tools: [...s.tools, ...added],
          ...(plan && { plan }),
        });
        break;
      }
      case 'model.failed':
        set({
          thinking: false,
          retrying: ev.retryable
            ? `The model call failed (${truncate(ev.error, 80)}). Trying again.`
            : undefined,
        });
        break;
      case 'approval.requested':
        setTool(ev.callId, 'waiting_approval');
        break;
      case 'approval.resolved':
        setTool(ev.callId, ev.granted ? 'running' : 'denied');
        break;
      case 'policy.decided':
        if (ev.decision.kind === 'deny') setTool(ev.callId, 'denied');
        break;
      case 'tool.started':
        setTool(ev.callId, 'running');
        break;
      case 'tool.completed':
        setTool(ev.callId, ev.result.ok ? 'ok' : 'failed');
        break;
    }
  }

  const hooks: RuntimeHooks = {
    onEvent: (e) => {
      if (running) onEvent(e);
    },
    onText: (delta) => {
      if (running) set({ streaming: s.streaming + delta });
    },
    onModelStart: () => {
      if (running) set({ thinking: true, streaming: '', retrying: undefined });
    },
  };
  const runtime = deps.runtime(hooks);

  function settle(patch: Partial<ChatState>) {
    // Keep what the task did on screen as history, then clear the live area.
    const done = s.tools.length ? [{ kind: 'tools' as const, lines: s.tools }] : [];
    set({
      phase: 'idle',
      thinking: false,
      streaming: '',
      tools: [],
      plan: undefined,
      step: 0,
      approval: undefined,
      question: undefined,
      retrying: undefined,
      items: [...s.items, ...done],
      ...patch,
    });
  }

  async function drive(id: string, my: number) {
    try {
      for (;;) {
        const o: RunOutcome = await runtime.advance(id);
        if (my !== gen) return;
        if (o.status === 'waiting_approval') {
          set({ phase: 'waiting_approval', thinking: false, approval: o.request });
          return;
        }
        if (o.status === 'waiting_user') {
          set({
            phase: 'waiting_user',
            thinking: false,
            question: o.question,
            approval: undefined,
          });
          return;
        }
        running = false;
        const prompt = current?.prompt ?? '';
        if (o.status === 'succeeded') {
          const answer = o.answer?.trim() || 'Done.';
          turns = [...turns, { prompt, answer }].slice(-MAX_CONTEXT_TURNS);
          settle({});
          push({ kind: 'reply', text: answer });
        } else if (o.status === 'failed') {
          settle({});
          push({
            kind: 'error',
            text: `${(o.reason ?? 'The task could not finish').replace(/\.$/, '')}. Send your message again, or see what happened: remy show ${id}`,
          });
        } else {
          settle({});
          push({ kind: 'note', text: `Cancelled. ${o.reason ?? ''}`.trim() });
        }
        return;
      }
    } catch (e) {
      if (my !== gen) return; // interrupted: the stopped run fails when it loses its lease
      running = false;
      settle({});
      push({ kind: 'error', text: friendlyError(e) });
    }
  }

  async function start(text: string) {
    const my = ++gen;
    sent.push(text);
    running = true;
    calls.clear();
    current = undefined;
    push({ kind: 'user', text });
    set({ phase: 'running', thinking: true, streaming: '', tools: [], plan: undefined, step: 0 });
    try {
      const id = await runtime.start(text, deps.config(turns));
      current = { id, prompt: text };
      set({ taskId: id });
      await drive(id, my);
    } catch (e) {
      if (my !== gen) return;
      running = false;
      settle({});
      push({ kind: 'error', text: friendlyError(e) });
    }
  }

  async function command(line: string) {
    const [name] = line.slice(1).split(/\s+/);
    if (name === 'help') push({ kind: 'note', text: HELP_TEXT });
    else if (name === 'new') {
      turns = [];
      push({ kind: 'note', text: 'Started a new conversation.' });
    } else if (name === 'exit' || name === 'quit') set({ wantsExit: true });
    else push({ kind: 'error', text: `Unknown command ${line.split(/\s+/)[0]}. Run /help.` });
    set({});
  }

  return {
    getState: () => s,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    history: () => sent,

    async submit(raw) {
      const text = raw.trim();
      if (!text) return;
      if (s.phase === 'waiting_user' && current) {
        const my = gen;
        const id = current.id;
        push({ kind: 'user', text });
        set({ phase: 'running', thinking: true, question: undefined });
        running = true;
        try {
          await runtime.answer(id, text);
          await drive(id, my);
        } catch (e) {
          if (my !== gen) return;
          running = false;
          settle({});
          push({ kind: 'error', text: friendlyError(e) });
        }
        return;
      }
      if (s.phase !== 'idle') return;
      if (text.startsWith('/')) return command(text);
      await start(text);
    },

    async approve(granted) {
      const a = s.approval;
      if (s.phase !== 'waiting_approval' || !a || !current) return;
      const my = gen;
      const id = current.id;
      set({ phase: 'running', approval: undefined, thinking: true });
      running = true;
      try {
        await runtime.approve(id, a.callId, a.argsHash, granted, 'user');
        await drive(id, my);
      } catch (e) {
        if (my !== gen) return;
        running = false;
        settle({});
        push({ kind: 'error', text: friendlyError(e) });
      }
    },

    async interrupt() {
      if (s.phase === 'idle') return;
      const id = current?.id;
      gen++;
      running = false;
      settle({});
      push({
        kind: 'note',
        text: id ? `Stopped. Continue with: remy resume ${id}` : 'Stopped before the task began.',
      });
      if (id) await deps.release(id).catch(() => {});
    },
  };
}

/** Releases a lease on the store for a task: used by `deps.release`. */
export const releaseLease = (store: EventStore, owner: string) => (taskId: string) =>
  store.releaseLease({ taskId, owner, expiresAt: 0 });

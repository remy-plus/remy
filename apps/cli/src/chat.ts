// The chat controller: drives the runtime for a conversation and exposes plain state.
// It knows nothing about Ink; the components in chat-ui.ts only render `getState()`.
import {
  type ApprovalRequest,
  type ConversationTurn,
  type Effect,
  type EventStore,
  ModelError,
  type RemyRuntime,
  type RunOutcome,
  type StoredEvent,
  TaskBusyError,
  type TaskConfig,
} from '@remy/core';
import { truncate } from './format.ts';
import {
  type ApprovalView,
  collapseFailure,
  describeApproval,
  flushTools,
  type PlanStep,
  summarizeTool,
  type ToolLine,
  type ToolState,
  toolDetail,
} from './transcript.ts';

export type { ApprovalView, PlanStep, ToolLine, ToolState };

/** Things that stay on screen once they are said. Appended once; never changed. */
export type Item =
  | { kind: 'user'; text: string }
  /** The final answer of a task. */
  | { kind: 'reply'; text: string }
  /** What the assistant said while working, one per model call. */
  | { kind: 'text'; text: string }
  | { kind: 'question'; text: string }
  | { kind: 'tool'; line: ToolLine }
  | { kind: 'plan'; steps: PlanStep[] }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

export type Phase = 'idle' | 'running' | 'waiting_approval' | 'waiting_user';

export interface ChatState {
  phase: Phase;
  /** The transcript so far. Every entry is committed exactly once. */
  items: Item[];
  /** The assistant text of the model call in flight. */
  streaming: string;
  /** True from the start of a model call until its reply arrives. */
  thinking: boolean;
  /** Tool lines of the active turn: running ones, and finished ones not yet committed. */
  tools: ToolLine[];
  plan?: PlanStep[];
  step: number;
  approval?: ApprovalRequest;
  approvalView?: ApprovalView;
  question?: string;
  taskId?: string;
  /** Messages typed while a task ran; they start in order once it ends. */
  queue: string[];
  /** When the active turn began (ms since epoch). */
  turnStartedAt?: number;
  /** Total spend of this conversation. */
  costUsd: number;
  /** Tokens (in and out) used by this conversation. */
  tokens: number;
  /** Prompt size of the latest model call: how full the context is. */
  contextTokens: number;
  /** The model's context window, when known. */
  contextWindow?: number;
  /** Spend of the current (or last) task, and the budget it may spend. */
  taskCostUsd: number;
  budgetUsd?: number;
  /** Set while a failed model call waits to be retried. */
  retrying?: string;
  /** The user asked to quit with /exit. */
  wantsExit?: boolean;
  /** Counts /clear, so the screen knows to start over. */
  clears: number;
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
  /** The model's context window in tokens, when it is known. */
  contextWindow?: number;
  /** A tool's effect, for telling whether an approval can be taken back. */
  effectOf?: (tool: string) => Effect | undefined;
}

export interface Chat {
  getState(): ChatState;
  subscribe(fn: () => void): () => void;
  /** A line from the user: a new message, an answer to a question, or a /command. */
  submit(text: string): Promise<void>;
  /** Answers the pending approval. A denial may carry a note the model reads. */
  approve(granted: boolean, note?: string): Promise<void>;
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
  '  Enter     send; while Remy works, the message waits its turn',
  '  Up        bring back your last message',
  '  Esc       clear the input',
  '  Ctrl+O    read the whole conversation, with details (q to go back)',
  '  Ctrl+C    stop the running task (resume it later); on an empty prompt, quit',
  '  Ctrl+D    quit',
  '  y / n     approve once or deny when Remy asks',
  '  e         deny and say why; Remy reads your note',
  '  v         show the whole action',
  '',
  'Commands',
  '  /help     this list',
  '  /new      start a fresh conversation',
  '  /clear    clear the screen and start a fresh conversation',
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
  queue: [],
  costUsd: 0,
  tokens: 0,
  contextTokens: 0,
  taskCostUsd: 0,
  clears: 0,
});

/** Finished tool lines beyond this many leave the live area at once. */
const MAX_LIVE_DONE = 4;

export function createChat(deps: ChatDeps): Chat {
  let s: ChatState = { ...initial(), contextWindow: deps.contextWindow };
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
  /** Moves things into the transcript. Each goes in once and is never touched again. */
  const commit = (...items: Item[]) => {
    if (items.length) set({ items: [...s.items, ...items] });
  };
  const setTool = (callId: string, patch: Partial<ToolLine>) => {
    if (!s.tools.some((t) => t.callId === callId)) return;
    set({ tools: s.tools.map((t) => (t.callId === callId ? { ...t, ...patch } : t)) });
  };
  /** Commits tool lines that are finished. `all` also commits a trailing failure. */
  const flush = (all: boolean, overflowOnly = false) => {
    const { commit: done, keep } = flushTools(s.tools, {
      keepFailure: !all,
      max: MAX_LIVE_DONE,
      overflowOnly,
    });
    if (done.length)
      set({
        tools: keep,
        items: [...s.items, ...done.map((line) => ({ kind: 'tool' as const, line }))],
      });
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
              ...summarizeTool(c.tool, c.args),
              state: 'running',
              count: 1,
            });
        }
        // What the model said alongside its tool calls is kept as it goes. With `finish` the
        // same words arrive as the answer, so they are not printed twice.
        const said = (ev.text ?? s.streaming).trim();
        // With no calls at all the words are the answer.
        const toCommit: Item[] =
          said && ev.calls.length > 0 && !ev.calls.some((c) => c.tool === 'finish')
            ? [{ kind: 'text', text: said }]
            : [];
        set({
          step: ev.step,
          thinking: false,
          retrying: undefined,
          streaming: '',
          costUsd: s.costUsd + ev.costUsd,
          tokens: s.tokens + ev.usage.inTokens + ev.usage.outTokens,
          taskCostUsd: s.taskCostUsd + ev.costUsd,
          contextTokens: ev.usage.inTokens,
          items: [...s.items, ...toCommit],
          tools: [...s.tools, ...added],
          ...(plan && { plan }),
        });
        break;
      }
      case 'model.failed':
        set({
          thinking: false,
          streaming: '',
          retrying: ev.retryable
            ? `The model call failed (${truncate(ev.error, 80)}). Trying again.`
            : undefined,
        });
        break;
      case 'approval.requested':
        setTool(ev.callId, { state: 'waiting_approval' });
        break;
      case 'approval.resolved':
        setTool(
          ev.callId,
          ev.granted
            ? { state: 'running' }
            : {
                state: 'denied',
                reason: ev.note ? `you said: ${truncate(ev.note, 60)}` : 'you said no',
              },
        );
        break;
      case 'policy.decided':
        if (ev.decision.kind === 'deny')
          setTool(ev.callId, { state: 'denied', reason: truncate(ev.decision.reason, 80) });
        break;
      case 'tool.started':
        setTool(ev.callId, { state: 'running', startedAt: Date.now() });
        break;
      case 'tool.completed': {
        const r = ev.result;
        const c = calls.get(ev.callId);
        const detail = c ? toolDetail(c.tool, c.args, r) : undefined;
        setTool(ev.callId, {
          ...(detail && { detail }),
          state: r.ok ? 'ok' : 'failed',
          ms: ev.latencyMs,
          ...(!r.ok && { reason: truncate(r.error, 80) }),
        });
        if (!r.ok) set({ tools: collapseFailure(s.tools, ev.callId) });
        flush(false, true);
        break;
      }
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
      if (!running) return;
      // The last call's tool lines are done: they go to the transcript before anything new.
      flush(false);
      set({ thinking: true, streaming: '', retrying: undefined });
    },
  };
  const runtime = deps.runtime(hooks);

  /** Ends the turn: whatever is still live goes to the transcript, then the live area empties. */
  function settle(succeeded = false) {
    const out: Item[] = s.tools.map((l) => ({
      kind: 'tool',
      line:
        l.state === 'running' || l.state === 'waiting_approval'
          ? { ...l, state: 'denied', reason: 'stopped' }
          : l,
    }));
    const plan = s.plan;
    // A finished plan is covered by the answer. Anything else is worth keeping.
    if (plan && plan.length > 1 && !(succeeded && plan.every((p) => p.status === 'done')))
      out.push({ kind: 'plan', steps: plan });
    set({
      phase: 'idle',
      thinking: false,
      streaming: '',
      tools: [],
      plan: undefined,
      step: 0,
      approval: undefined,
      approvalView: undefined,
      question: undefined,
      retrying: undefined,
      turnStartedAt: undefined,
      items: [...s.items, ...out],
    });
  }

  /** Starts the next queued message, if any. */
  async function drain() {
    const next = s.queue[0];
    if (next === undefined || s.phase !== 'idle') return;
    set({ queue: s.queue.slice(1) });
    await api.submit(next);
  }

  async function end(succeeded: boolean, ...items: Item[]) {
    running = false;
    settle(succeeded);
    commit(...items);
    await drain();
  }

  async function drive(id: string, my: number) {
    try {
      for (;;) {
        const o: RunOutcome = await runtime.advance(id);
        if (my !== gen) return;
        if (o.status === 'waiting_approval') {
          const c = calls.get(o.request.callId);
          set({
            phase: 'waiting_approval',
            thinking: false,
            approval: o.request,
            approvalView: describeApproval(
              c?.tool ?? '',
              c?.args,
              o.request,
              deps.effectOf?.(c?.tool ?? ''),
            ),
          });
          return;
        }
        if (o.status === 'waiting_user') {
          flush(true);
          commit({ kind: 'question', text: o.question });
          set({
            phase: 'waiting_user',
            thinking: false,
            question: o.question,
            approval: undefined,
          });
          return;
        }
        const prompt = current?.prompt ?? '';
        if (o.status === 'succeeded') {
          const answer = o.answer?.trim() || 'Done.';
          turns = [...turns, { prompt, answer }].slice(-MAX_CONTEXT_TURNS);
          return await end(true, { kind: 'reply', text: answer });
        }
        if (o.status === 'failed')
          return await end(false, {
            kind: 'error',
            text: `${(o.reason ?? 'The task could not finish').replace(/\.$/, '')}. Send your message again, or see what happened: remy show ${id}`,
          });
        return await end(false, { kind: 'note', text: `Cancelled. ${o.reason ?? ''}`.trim() });
      }
    } catch (e) {
      if (my !== gen) return; // interrupted: the stopped run fails when it loses its lease
      await end(false, { kind: 'error', text: friendlyError(e) });
    }
  }

  async function start(text: string) {
    const my = ++gen;
    sent.push(text);
    running = true;
    calls.clear();
    current = undefined;
    commit({ kind: 'user', text });
    set({
      phase: 'running',
      thinking: true,
      streaming: '',
      tools: [],
      plan: undefined,
      step: 0,
      turnStartedAt: Date.now(),
      taskCostUsd: 0,
    });
    try {
      const config = deps.config(turns);
      set({ budgetUsd: config.budget.maxCostUsd });
      const id = await runtime.start(text, config);
      current = { id, prompt: text };
      set({ taskId: id });
      await drive(id, my);
    } catch (e) {
      if (my !== gen) return;
      await end(false, { kind: 'error', text: friendlyError(e) });
    }
  }

  function command(line: string) {
    const [name] = line.slice(1).split(/\s+/);
    if (name === 'help') commit({ kind: 'note', text: HELP_TEXT });
    else if (name === 'new') {
      turns = [];
      commit({ kind: 'note', text: 'Started a new conversation.' });
    } else if (name === 'clear') {
      turns = [];
      // The screen wipes itself and prints the header again; the transcript starts empty.
      set({ items: [], clears: s.clears + 1 });
    } else if (name === 'exit' || name === 'quit') set({ wantsExit: true });
    else commit({ kind: 'error', text: `Unknown command ${line.split(/\s+/)[0]}. Run /help.` });
  }

  const api: Chat = {
    getState: () => s,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    history: () => sent,

    async submit(raw) {
      const text = raw.trim();
      if (!text) return;
      if (/^\/(exit|quit)$/.test(text)) return void set({ wantsExit: true });
      if (s.phase === 'waiting_user' && current) {
        const my = gen;
        const id = current.id;
        sent.push(text);
        commit({ kind: 'user', text });
        set({ phase: 'running', thinking: true, question: undefined });
        running = true;
        try {
          await runtime.answer(id, text);
          await drive(id, my);
        } catch (e) {
          if (my !== gen) return;
          await end(false, { kind: 'error', text: friendlyError(e) });
        }
        return;
      }
      // A task is running: keep the message for after it, in order.
      if (s.phase !== 'idle') return void set({ queue: [...s.queue, text] });
      if (text.startsWith('/')) return command(text);
      await start(text);
    },

    async approve(granted, note) {
      const a = s.approval;
      if (s.phase !== 'waiting_approval' || !a || !current) return;
      const my = gen;
      const id = current.id;
      set({ phase: 'running', approval: undefined, approvalView: undefined, thinking: true });
      running = true;
      try {
        await runtime.approve(id, a.callId, a.argsHash, granted, 'user', note);
        await drive(id, my);
      } catch (e) {
        if (my !== gen) return;
        await end(false, { kind: 'error', text: friendlyError(e) });
      }
    },

    async interrupt() {
      if (s.phase === 'idle') return;
      const id = current?.id;
      const dropped = s.queue.length;
      gen++;
      running = false;
      settle();
      commit({
        kind: 'note',
        text:
          (id ? `Stopped. Continue with: remy resume ${id}` : 'Stopped before the task began.') +
          (dropped
            ? ` ${dropped} queued ${dropped === 1 ? 'message was' : 'messages were'} dropped.`
            : ''),
      });
      set({ queue: [] });
      if (id) await deps.release(id).catch(() => {});
    },
  };
  return api;
}

/** Releases a lease on the store for a task: used by `deps.release`. */
export const releaseLease = (store: EventStore, owner: string) => (taskId: string) =>
  store.releaseLease({ taskId, owner, expiresAt: 0 });

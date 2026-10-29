// The chat controller: drives the runtime for a conversation and exposes plain state.
// It knows nothing about Ink; the components in chat-ui.ts only render `getState()`.
import {
  type ApprovalRequest,
  type ConversationTurn,
  type Effect,
  type EventStore,
  fold,
  ModelError,
  type RemyRuntime,
  type Risk,
  type RunOutcome,
  type StoredEvent,
  TaskBusyError,
  type TaskConfig,
  type TaskStatus,
  type TaskSummary,
} from '@remy/core';
import { type ApprovalsStore, plainApprovals } from './approvals.ts';
import { COMMANDS, findCommand } from './commands.ts';
import type { ConnectFlowApi } from './connect-ui.ts';
import { CONNECT_HELP, type ConnectionsApi, plainConnections } from './connections-view.ts';
import { truncate } from './format.ts';
import type { LoginEntry, LoginResult, ProviderChoice } from './login-ui.ts';
import { type MemoryStore, plainMemory } from './memory.ts';
import { completePaths, fileContext, MAX_FILES, mentionedPaths } from './mentions.ts';
import { defaultMore, type More, pauseQuestion } from './pause.ts';
import { isThemeChoice, type ThemeChoice } from './prefs.ts';
import { bodyMessage, explainTooLarge, providerName } from './provider-error.ts';
import {
  changedPaths,
  type FileTouch,
  sessionTitle,
  touchFiles,
  workspacePath,
} from './session-data.ts';
import { createTextBatcher, FRAME_MS, type Gate } from './stream.ts';
import {
  type ApprovalView,
  collapseFailure,
  describeApproval,
  flushTools,
  type PlanStep,
  stopPlan,
  summarizeTool,
  type ToolLine,
  type ToolState,
  toolDetail,
} from './transcript.ts';

export type { ApprovalView, FileTouch, PlanStep, ToolLine, ToolState };

/** Things that stay on screen once they are said. Appended once; never changed. */
export type Item =
  | { kind: 'user'; text: string }
  /** The final answer of a task, with the model that gave it and how long the turn took. */
  | { kind: 'reply'; text: string; model?: string; ms?: number }
  /** What the assistant said while working, one per model call. */
  | { kind: 'text'; text: string }
  | { kind: 'question'; text: string }
  | { kind: 'tool'; line: ToolLine }
  | { kind: 'plan'; steps: PlanStep[]; note?: string }
  | { kind: 'note'; text: string; model?: string; ms?: number; stopped?: boolean }
  | { kind: 'error'; text: string; model?: string; ms?: number };

/** One resumable task in the `/resume` picker. */
export interface SessionRow {
  taskId: string;
  /** From the first prompt. */
  title: string;
  status: TaskStatus;
  /** A background worker is driving this task now. */
  background?: boolean;
  /** ISO time of the last event. */
  updatedAt: string;
}

/** The first four characters of a task's id, as shown in banners. */
export const shortId = (taskId: string) => taskId.replace(/^task_/, '').slice(0, 4);

/** `Resuming 7c2e: 2 of 4 steps done. Next: move files.` or, with no plan, a plain line. */
export function resumeBanner(taskId: string, plan: PlanStep[] | undefined): string {
  const head = `Resuming ${shortId(taskId)}`;
  if (!plan?.length) return `${head}.`;
  const done = plan.filter((p) => p.status === 'done').length;
  const next = plan.find((p) => p.status === 'doing') ?? plan.find((p) => p.status === 'pending');
  const n = plan.length;
  return `${head}: ${done} of ${n} ${n === 1 ? 'step' : 'steps'} done.${next ? ` Next: ${next.text.replace(/\.$/, '')}.` : ''}`;
}

/** One model the user can switch to: a saved login and a model id. */
export interface ModelChoice {
  provider: string;
  model: string;
  /** Price and context, one short line. */
  detail: string;
}

export interface SwitchResult {
  ok: boolean;
  message: string;
  model?: string;
  contextWindow?: number;
}

/** What `/login` and `/model` need from the host: saved logins and a way to change models. */
export interface ConnectApi {
  providers(): ProviderChoice[];
  models(): ModelChoice[];
  /** Verifies and saves a login, then switches to it when a model is known. */
  login(entry: LoginEntry): Promise<LoginResult & Omit<SwitchResult, 'ok' | 'message'>>;
  use(provider: string, model: string): Promise<SwitchResult>;
}

/** Workspace files for `@path`, read through the workspace's ScopedFs. */
export interface FilesApi {
  list(path: string): Promise<{ name: string; dir: boolean }[]>;
  read(path: string): Promise<string | undefined>;
}

export type Overlay =
  | 'login'
  | 'model'
  | 'palette'
  | 'theme'
  | 'profile'
  | 'memory'
  | 'connections'
  | 'connect';

export type Phase = 'idle' | 'running' | 'waiting_approval' | 'waiting_user' | 'paused';

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
  /** While paused: the question the card asks and what a yes adds. */
  pause?: { question: string; more: Required<More> };
  taskId?: string;
  /** Messages typed while a task ran; they start in order once it ends. */
  queue: string[];
  /** When the active turn began (ms since epoch). */
  turnStartedAt?: number;
  /** The session title: the first message, one line, about 48 characters. */
  title?: string;
  /** Files written, edited, moved or deleted this session (workspace-relative), newest first. */
  filesTouched?: FileTouch[];
  /** Total spend of this conversation. */
  costUsd: number;
  /** Tokens (in and out) used by this conversation. */
  tokens: number;
  /** Input tokens this conversation sent, and how many of them the provider read from its prompt cache. */
  inTokens: number;
  cachedTokens: number;
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
  /** Reasoning summary of the current model call, if the provider streams one. Never stored. */
  reasoning: string;
  /** /thinking: show the summary text under the status row. */
  showThinking: boolean;
  /** The `/resume` picker, open while it holds rows. */
  picker?: SessionRow[];
  /** Counts /clear, so the screen knows to start over. */
  clears: number;
  /** The model in use; undefined until one is connected. */
  model?: string;
  /** A panel that takes over the input: the login, the model list or the command palette. */
  overlay?: Overlay;
  /** The colour theme in use: `auto` follows the terminal. */
  theme: ThemeChoice;
}

export interface RuntimeHooks {
  onEvent: (e: StoredEvent) => void;
  onText: (delta: string) => void;
  onModelStart: () => void;
  onReasoning: (delta: string) => void;
}

export interface ChatDeps {
  /** Builds the runtime with the controller's hooks wired in. */
  runtime: (hooks: RuntimeHooks) => RemyRuntime;
  /** The config for a new task; `context` carries the earlier turns. */
  config: (context: ConversationTurn[]) => TaskConfig;
  /** Tasks in the store, newest first, for `/resume`. */
  listTasks?: () => Promise<TaskSummary[]>;
  /** /bg: starts a task in a detached worker and returns its id. */
  background?: { start: (prompt: string) => Promise<string>; isRunning: (id: string) => boolean };
  /** A task's events, to rebuild what it was doing. */
  readEvents?: (taskId: string) => Promise<StoredEvent[]>;
  /** Lets go of a task's lease so `remy resume` can take it. */
  release: (taskId: string) => Promise<void>;
  /** The model's context window in tokens, when it is known. */
  contextWindow?: number;
  /** The model in use at the start; none means the chat opens on the login panel. */
  model?: string;
  connect?: ConnectApi;
  /** The connected tool servers, for /connections. */
  connections?: ConnectionsApi;
  /** Standing approvals ("always allow"), for the `a` key and /approvals. */
  approvals?: ApprovalsStore;
  /** A tool's risk, for listing standing approvals. */
  riskOf?: (tool: string) => Risk | undefined;
  /** Adds an app or service, for /connect. */
  addConnection?: ConnectFlowApi;
  /** Settles when connected servers have had their start budget; sending waits for it. */
  ready?: () => Promise<void>;
  files?: FilesApi;
  /** A tool's effect, for telling whether an approval can be taken back. */
  effectOf?: (tool: string) => Effect | undefined;
  /** Streamed text reaches subscribers at most once per this many ms. Default 16; 0 is per delta. */
  frameMs?: number;
  /** Holds streamed text back while the terminal is not keeping up (see `stdoutGate`). */
  gate?: Gate;
  /** `/new` empties the transcript (the full-screen app returns to its home screen). */
  newClears?: boolean;
  /** The saved theme choice at the start. Default `auto`. */
  theme?: ThemeChoice;
  /** Saves the theme choice for next time; false when it could not be written. */
  saveTheme?: (choice: ThemeChoice) => boolean;
  /** The saved minimal-screen preference at the start. */
  minimal?: boolean;
  /** Saves the minimal-screen preference; false when it could not be written. */
  saveMinimal?: (on: boolean) => boolean;
  /** /profile opens when the host keeps a profile. */
  profileEnabled?: boolean;
  /** /memory: the saved notes about the user, and whether they are in use. */
  memory?: { store: MemoryStore; personalise: () => boolean };
  /** /tour replays the onboarding; absent where there is none. */
  startTour?: () => void;
}

export interface Chat {
  getState(): ChatState;
  subscribe(fn: () => void): () => void;
  /** A line from the user: a new message, an answer to a question, or a /command. */
  submit(text: string, pasted?: string[]): Promise<void>;
  /** Closes the `/resume` picker. */
  closePicker(): void;
  openOverlay(which: Overlay): void;
  /** Closes the panel; with `only`, just when that panel is the one open. */
  closeOverlay(only?: Overlay): void;
  /** Applies a theme at once and saves it. */
  setTheme(choice: ThemeChoice): void;
  /** A quiet note for the transcript from outside the chat; held back while the home screen shows. */
  notify(text: string): void;
  /** The connected servers with every change noted in the transcript. */
  connections(): ConnectionsApi;
  /** The /connect flow's backend; each result is noted in the transcript. */
  addConnection(): ConnectFlowApi;
  /** Runs a command by name, as if typed (the palette uses this). */
  runCommand(name: string): Promise<void>;
  providers(): ProviderChoice[];
  models(): ModelChoice[];
  /** The login panel's submit: saves, and switches when a model is known. */
  saveLogin(entry: LoginEntry): Promise<LoginResult>;
  /** Switches the model for the next message; the conversation carries over. */
  chooseModel(provider: string, model: string): Promise<void>;
  /** Paths in the workspace for `@query`. */
  completeFiles(query: string): Promise<string[]>;
  /** Picks up an unfinished task from the store and carries on with it. */
  resume(taskId: string): Promise<void>;
  /** Answers the pending approval. A denial may carry a note the model reads; `always` also saves a standing approval for the tool. */
  approve(granted: boolean, note?: string, always?: boolean): Promise<void>;
  /** Answers the pause card: yes gives the task more budget, no leaves it paused (`remy continue`). */
  continueRun(yes: boolean): Promise<void>;
  /** Stops the running task. It stays resumable. */
  interrupt(): Promise<void>;
  /**
   * Interrupts the running task and sends this message in its place. Messages already queued
   * keep their place behind it. With no task running it is a plain `submit`.
   */
  sendNow(text: string, pasted?: string[]): Promise<void>;
  /** A key was pressed: streamed text shows up in short frames for a moment, so typing stays instant. */
  noteInput(): void;
  /** The messages the user has sent, oldest first, for recall. */
  history(): string[];
  /** Starts a task in the given folder instead of the conversation's workspace (the tour's first task). */
  startTask(prompt: string, workspaceDir: string): Promise<void>;
}

/** Earlier turns sent as context are capped so a long chat does not outgrow the model. */
export const MAX_CONTEXT_TURNS = 20;

/**
 * Past the cap the oldest half goes at once, not one turn per message: the first turn sent then
 * stays the same for ten messages at a time, so the provider's prompt cache keeps working.
 */
export function keepTurns<T>(turns: T[]): T[] {
  return turns.length > MAX_CONTEXT_TURNS ? turns.slice(MAX_CONTEXT_TURNS / 2) : turns;
}

export const HELP_TEXT = [
  'Type a message and press Enter. Remy answers, and asks before anything it should not do alone.',
  '',
  'Keys',
  '  Enter     send; while Remy works, the message waits its turn',
  '  Ctrl+S    while Remy works: stop it and send this message now (also Alt+Enter)',
  '  /         commands as you type; Tab completes',
  '  Ctrl+P    command palette: every command, filtered as you type',
  '  @         attach a workspace file: @notes.txt',
  '  Ctrl+J    new line (or type \\ then Enter); a big paste shows as [Pasted ~N lines]',
  '  Ctrl+W    delete a word; Ctrl+K delete to the end of the line',
  '  Up        bring back your last message',
  '  Esc       clear the input',
  '  Ctrl+B    show or hide the sidebar (full screen, wide terminals)',
  '  Ctrl+O    read the whole conversation, with details (q to go back)',
  '  Ctrl+C    stop the running task (resume it later); on an empty prompt, quit',
  '  Ctrl+D    quit',
  '  y / n     approve once or deny when Remy asks',
  '  a         approve and always allow that tool (writes and sends only; undo with /approvals)',
  '  e         deny and say why; Remy reads your note',
  '  v         show the whole action',
  '',
  'Commands',
  ...COMMANDS.map((c) => `  /${c.name.padEnd(12)} ${c.summary}`),
].join('\n');

/** `/day` and `/night` are `/theme light` and `/theme dark`; `/light` and `/dark` name the theme. */
const ALIAS_THEME: Record<string, ThemeChoice> = {
  light: 'light',
  day: 'light',
  dark: 'dark',
  night: 'dark',
};

/** Tools that are plumbing, not work worth a status line. */
const QUIET_TOOLS = new Set(['finish', 'ask_user', 'update_plan', 'find_tools']);

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
      // A skipped step is settled, so it shows as done.
      status:
        s.status === 'skipped'
          ? 'done'
          : STATUSES.has(s.status as string)
            ? (s.status as PlanStep['status'])
            : 'pending',
    });
  }
  return out.length ? out : undefined;
}

/** A model failure in plain words, ending with the one thing to do. Undefined when unknown. */
export function explainModelError(msg: string): string | undefined {
  const large = explainTooLarge(msg);
  if (large) return large;
  const m = msg.toLowerCase();
  if (/http (401|403)\b|invalid api key|incorrect api key|unauthorized|api_key_invalid/.test(m))
    return 'The key was rejected. Run /login to replace it.';
  if (/http 429|rate limit|too many requests/.test(m))
    return `${providerName(msg)} is rate-limiting this key. Wait a minute and send your message again, or switch with /model.`;
  if (/insufficient_quota|exceeded your current quota|http 402|out of credit/.test(m))
    return 'The account is out of credit. Add credit with the provider, or switch with /model.';
  if (/http 404|model_not_found|does not exist|not found/.test(m) && /model/.test(m))
    return 'This key cannot use that model. Pick another with /model.';
  if (/network error|fetch failed|enotfound|econnrefused|econnreset|timed out|etimedout/.test(m))
    return 'Could not reach the model. Check your connection, then send your message again.';
  return undefined;
}

/** One calm line: what happened, then what to do next. */
export function friendlyError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).trim().replace(/\s+/g, ' ');
  const known = explainModelError(msg);
  if (known) return known;
  if (e instanceof ModelError)
    return `The model did not answer: ${truncate(bodyMessage(msg), 160)}. Send your message again, or switch with /model.`;
  if (e instanceof TaskBusyError)
    return 'Another run holds this task. Wait a few seconds, then send your message again.';
  return `${truncate(bodyMessage(msg), 200)}. Send your message again, or run /help.`;
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
  inTokens: 0,
  cachedTokens: 0,
  contextTokens: 0,
  taskCostUsd: 0,
  reasoning: '',
  showThinking: false,
  clears: 0,
  theme: 'auto',
});

/** Finished tool lines beyond this many leave the live area at once. */
const MAX_LIVE_DONE = 4;
/** Reasoning kept for display only; the newest characters win. */
const MAX_REASONING_CHARS = 2000;
/** The picker shows this many tasks, newest first. */
const MAX_PICKER_ROWS = 8;

export function createChat(deps: ChatDeps): Chat {
  let s: ChatState = {
    ...initial(),
    contextWindow: deps.contextWindow,
    ...(deps.model && { model: deps.model }),
    ...(deps.theme && { theme: deps.theme }),
    // With no model yet, the chat opens on the login panel.
    ...(deps.connect && !deps.model && { overlay: 'login' as const }),
  };
  let turns: ConversationTurn[] = [];
  let minimal = deps.minimal ?? false;
  const sent: string[] = [];
  const listeners = new Set<() => void>();
  /** Bumped by interrupt and /new, so a stopped run's late callbacks are ignored. */
  let gen = 0;
  let current: { id: string; prompt: string; pasted?: string[] } | undefined;
  /** Pasted segments of messages still waiting in the queue, by text. */
  const pastedFor = new Map<string, string[]>();
  /** True while a run is live; false once it was interrupted, so late callbacks are ignored. */
  let running = false;
  const calls = new Map<string, { tool: string; args: unknown }>();
  let workspaceDir: string | undefined;

  /** Streamed text waits here and joins the state with the next update, so order holds. */
  const batch = createTextBatcher(deps.frameMs ?? FRAME_MS, () => set({}), {
    ...(deps.gate && { gate: deps.gate }),
  });

  const set = (patch: Partial<ChatState>) => {
    const waiting = batch.take();
    if (waiting) s = { ...s, streaming: s.streaming + waiting };
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
    if (batch.pending) set({}); // text that came first is in the state before the event acts
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
          inTokens: s.inTokens + ev.usage.inTokens,
          cachedTokens: s.cachedTokens + (ev.usage.cachedInTokens ?? 0),
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
            ? `${explainModelError(ev.error)?.split('. ')[0] ?? `The model call failed (${truncate(bodyMessage(ev.error), 80)})`}. Trying again.`
            : undefined,
        });
        break;
      case 'approval.requested':
        setTool(ev.callId, { state: 'waiting_approval' });
        break;
      case 'progress':
        flush(true);
        set({ items: [...s.items, { kind: 'note', text: ev.text }] });
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
        else if (c) {
          const paths = changedPaths(c.tool, c.args).map((p) => workspacePath(p, workspaceDir));
          if (paths.length) set({ filesTouched: touchFiles(s.filesTouched ?? [], paths) });
        }
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
      if (running) batch.push(delta);
    },
    onReasoning: (delta) => {
      if (running) set({ reasoning: (s.reasoning + delta).slice(-MAX_REASONING_CHARS) });
    },
    onModelStart: () => {
      if (!running) return;
      // The last call's tool lines are done: they go to the transcript before anything new.
      flush(false);
      set({ thinking: true, streaming: '', reasoning: '', retrying: undefined });
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
      out.push({ kind: 'plan', ...stopPlan(plan) });
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
      pause: undefined,
      retrying: undefined,
      turnStartedAt: undefined,
      items: [...s.items, ...out],
    });
  }

  /**
   * Stops the running turn. `forSend` is a send-now: the queue stays and the note says why it stopped.
   */
  async function halt(forSend: boolean) {
    if (s.phase === 'idle') return;
    const id = current?.id;
    const dropped = forSend ? 0 : s.queue.length;
    const meta = turnMeta();
    gen++;
    running = false;
    settle();
    commit({
      kind: 'note',
      stopped: true,
      ...meta,
      text:
        (id
          ? forSend
            ? `Stopped to send your message. Continue the earlier task with: remy resume ${id}`
            : `Stopped. Continue with: remy resume ${id}`
          : 'Stopped before the task began.') +
        (dropped
          ? ` ${dropped} queued ${dropped === 1 ? 'message was' : 'messages were'} dropped.`
          : ''),
    });
    if (!forSend) set({ queue: [] });
    if (id) await deps.release(id).catch(() => {});
  }

  /** Starts the next queued message, if any. */
  async function drain() {
    const next = s.queue[0];
    if (next === undefined || s.phase !== 'idle') return;
    set({ queue: s.queue.slice(1) });
    await api.submit(next);
  }

  /** The model and elapsed time of the turn in flight, for the footer under a failed or stopped turn. */
  const turnMeta = () => ({
    ...(s.model && { model: s.model }),
    ...(s.turnStartedAt !== undefined && { ms: Date.now() - s.turnStartedAt }),
  });

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
        if (o.status === 'paused') {
          flush(true);
          const more = defaultMore(await runtime.state(id));
          const question = pauseQuestion(o, more);
          commit({ kind: 'note', text: question });
          set({ phase: 'paused', thinking: false, pause: { question, more }, approval: undefined });
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
          turns = keepTurns([
            ...turns,
            { prompt, answer, ...(current?.pasted?.length && { pasted: current.pasted }) },
          ]);
          const ms = s.turnStartedAt === undefined ? undefined : Date.now() - s.turnStartedAt;
          return await end(true, {
            kind: 'reply',
            text: answer,
            ...(s.model && { model: s.model }),
            ...(ms !== undefined && { ms }),
          });
        }
        if (o.status === 'failed')
          return await end(false, {
            kind: 'error',
            text:
              explainModelError(o.reason ?? '') ??
              `${bodyMessage(o.reason ?? 'The task could not finish').replace(/\.$/, '')}. Send your message again, or see what happened: remy show ${id}`,
            ...turnMeta(),
          });
        return await end(false, {
          kind: 'note',
          text: `Cancelled. ${o.reason ?? ''}`.trim(),
          stopped: true,
          ...turnMeta(),
        });
      }
    } catch (e) {
      if (my !== gen) return; // interrupted: the stopped run fails when it loses its lease
      await end(false, { kind: 'error', text: friendlyError(e), ...turnMeta() });
    }
  }

  /** Reads the files a message mentions. Their text rides along as untrusted context. */
  async function attach(text: string) {
    if (!deps.files) return undefined;
    const found: string[] = [];
    const missing: string[] = [];
    const blocks: string[] = [];
    for (const path of mentionedPaths(text).slice(0, MAX_FILES)) {
      const body = await deps.files.read(path).catch(() => undefined);
      if (body === undefined) missing.push(path);
      else {
        found.push(path);
        blocks.push(fileContext(body));
      }
    }
    const notes: string[] = [];
    if (found.length) notes.push(`Attached ${found.join(', ')}.`);
    if (missing.length)
      notes.push(`Could not read ${missing.join(', ')} in the workspace. Type @ to pick a file.`);
    if (!notes.length) return undefined;
    const prompt = found.length
      ? `${text}\n\nFiles the user attached (read-only copies):\n${found
          .map((p, i) => `--- ${p} ---\n${blocks[i]}`)
          .join('\n\n')}`
      : text;
    return { prompt, pasted: blocks.filter(Boolean), notes };
  }

  /** Notes that arrived while the home screen showed wait for the first message. */
  const held: string[] = [];
  const flushHeld = () => {
    if (held.length) commit(...held.splice(0).map((text): Item => ({ kind: 'note', text })));
  };

  async function start(text: string, folder?: string) {
    if (deps.connect && !s.model) {
      // Keep the message; it is sent once a model is connected.
      commit({ kind: 'note', text: 'Connect a model first, then your message goes through.' });
      return void set({ queue: [...s.queue, text], overlay: 'login' });
    }
    const my = ++gen;
    sent.push(text);
    running = true;
    calls.clear();
    current = undefined;
    commit({ kind: 'user', text });
    flushHeld();
    if (!s.title) set({ title: sessionTitle(text, pastedFor.get(text)) });
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
      if (deps.ready) await deps.ready();
      const typedPaste = pastedFor.get(text);
      pastedFor.delete(text);
      const files = await attach(text);
      if (files) for (const n of files.notes) commit({ kind: 'note', text: n });
      const prompt = files?.prompt ?? text;
      const pasted = [...(typedPaste ?? []), ...(files?.pasted ?? [])];
      const base = folder ? { ...deps.config(turns), workspaceDir: folder } : deps.config(turns);
      workspaceDir = base.workspaceDir;
      const config = pasted.length ? { ...base, pasted } : base;
      set({ budgetUsd: config.budget.maxCostUsd });
      const id = await runtime.start(prompt, config);
      current = { id, prompt, ...(pasted.length && { pasted }) };
      set({ taskId: id });
      await drive(id, my);
    } catch (e) {
      if (my !== gen) return;
      await end(false, { kind: 'error', text: friendlyError(e) });
    }
  }

  const RESUMABLE: TaskStatus[] = ['running', 'waiting_approval', 'waiting_user', 'paused'];

  async function openPicker() {
    const all = (await deps.listTasks?.()) ?? [];
    const picked = all
      .filter((t) => RESUMABLE.includes(t.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_PICKER_ROWS);
    const rows: SessionRow[] = [];
    for (const t of picked) {
      // The title is what the user typed: pasted text stays out of it.
      const first = (await deps.readEvents?.(t.taskId))?.[0]?.event;
      const pasted = first?.type === 'task.created' ? (first.config.pasted ?? []) : [];
      let typed = t.prompt;
      for (const seg of pasted) typed = typed.split(seg).join(' ');
      typed = typed.replace(/\s+/g, ' ').trim();
      rows.push({
        taskId: t.taskId,
        title: truncate(typed || '(pasted text)', 80),
        status: t.status,
        updatedAt: t.updatedAt,
        ...(deps.background?.isRunning(t.taskId) && { background: true }),
      });
    }
    if (!rows.length)
      return commit({ kind: 'note', text: 'Nothing to resume. Unfinished tasks show up here.' });
    set({ picker: rows });
  }

  async function resumeTask(id: string) {
    set({ picker: undefined });
    const my = ++gen;
    try {
      if (deps.ready) await deps.ready();
      const events = (await deps.readEvents?.(id)) ?? [];
      if (!events.length) return commit({ kind: 'error', text: `There is no task ${id}.` });
      const st = fold(events);
      if (!RESUMABLE.includes(st.status))
        return commit({ kind: 'note', text: `Task ${shortId(id)} already ${st.status}.` });
      let plan: PlanStep[] | undefined;
      calls.clear();
      for (const c of Object.values(st.calls).sort((a, b) => a.step - b.step)) {
        calls.set(c.callId, { tool: c.tool, args: c.args });
        if (c.tool === 'update_plan') plan = parsePlan(c.args) ?? plan;
      }
      running = true;
      current = {
        id,
        prompt: st.prompt,
        ...(st.config.pasted?.length && { pasted: st.config.pasted }),
      };
      workspaceDir = st.config.workspaceDir;
      commit({ kind: 'user', text: st.prompt }, { kind: 'note', text: resumeBanner(id, plan) });
      // A new process starts without the sidebar's facts: rebuild them from the stored events.
      let touched: FileTouch[] = s.filesTouched ?? [];
      for (const c of Object.values(st.calls).sort((a, b) => a.step - b.step)) {
        if (!c.result?.ok) continue;
        const paths = changedPaths(c.tool, c.args).map((p) => workspacePath(p, workspaceDir));
        if (paths.length) touched = touchFiles(touched, paths);
      }
      if (touched.length) set({ filesTouched: touched });
      if (!s.title) set({ title: sessionTitle(st.prompt, st.config.pasted) });
      set({
        phase: 'running',
        thinking: true,
        streaming: '',
        tools: [],
        plan,
        taskId: id,
        step: 0,
        turnStartedAt: Date.now(),
        taskCostUsd: st.costUsd,
        budgetUsd: st.config.budget.maxCostUsd,
      });
      await drive(id, my);
    } catch (e) {
      if (my !== gen) return;
      await end(false, { kind: 'error', text: friendlyError(e) });
    }
  }

  function command(line: string): Promise<void> | undefined {
    const [typed = '', ...args] = line.slice(1).split(/\s+/);
    const name = findCommand(typed)?.name;
    if (name === 'help') commit({ kind: 'note', text: HELP_TEXT });
    else if (name === 'new') {
      turns = [];
      if (deps.newClears) set({ items: [], title: undefined, filesTouched: undefined });
      else {
        set({ title: undefined, filesTouched: undefined });
        commit({ kind: 'note', text: 'Started a new conversation.' });
      }
    } else if (name === 'clear') {
      turns = [];
      // The screen wipes itself and prints the header again; the transcript starts empty.
      set({ items: [], clears: s.clears + 1, title: undefined, filesTouched: undefined });
    } else if (name === 'sessions') {
      return openPicker();
    } else if (name === 'login' || name === 'model') {
      if (!deps.connect)
        return void commit({ kind: 'note', text: 'Models are set when Remy starts here.' });
      const wanted = args.join(' ');
      const hit = wanted ? deps.connect.models().find((m) => m.model === wanted) : undefined;
      if (name === 'model' && hit) return api.chooseModel(hit.provider, hit.model);
      set({ overlay: name });
    } else if (name === 'connect') {
      if (deps.addConnection) set({ overlay: 'connect' });
      else commit({ kind: 'note', text: CONNECT_HELP });
    } else if (name === 'approvals') {
      if (!deps.approvals)
        return void commit({ kind: 'note', text: 'There are no standing approvals here.' });
      if (args[0] === 'remove' && args[1]) {
        const gone = deps.approvals.remove(args[1]);
        return void commit({
          kind: 'note',
          text: gone
            ? `${args[1]} asks again from now on. A task already running keeps what it started with.`
            : `${args[1]} is not on the list.`,
        });
      }
      commit({
        kind: 'note',
        text: `${plainApprovals(deps.approvals.load(), (t) => deps.riskOf?.(t))}\nRemove one with /approvals remove <tool>.`,
      });
    } else if (name === 'connections') {
      if (!deps.connections)
        return void commit({ kind: 'note', text: 'There are no connections here.' });
      const rows = deps.connections.list();
      // A plain list when asked for, and when there is nothing to open a panel for.
      if (args[0] === 'list' || !rows.length)
        return void commit({ kind: 'note', text: plainConnections(rows) });
      set({ overlay: 'connections' });
    } else if (name === 'thinking') {
      const on = !s.showThinking;
      set({ showThinking: on });
      commit({
        kind: 'note',
        text: on ? 'Showing thinking when the model shares it.' : 'Thinking detail is off.',
      });
    } else if (name === 'theme') {
      const word = ALIAS_THEME[typed] ?? args[0]?.toLowerCase();
      if (!word) return void set({ overlay: 'theme' });
      if (!isThemeChoice(word))
        return void commit({
          kind: 'error',
          text: `There is no theme "${word}". Use /theme auto, light or dark.`,
        });
      api.setTheme(word);
    } else if (name === 'minimal') {
      const on = !minimal;
      const saved = deps.saveMinimal?.(on) ?? false;
      if (saved) minimal = on;
      commit({
        kind: 'note',
        text: !saved
          ? 'Could not save the minimal setting.'
          : on
            ? 'Minimal screen is on. It takes effect the next time Remy starts.'
            : 'Minimal screen is off. The full screen returns the next time Remy starts.',
      });
    } else if (name === 'profile') {
      if (!deps.profileEnabled)
        return void commit({ kind: 'note', text: 'There is no profile to edit here.' });
      set({ overlay: 'profile' });
    } else if (name === 'memory') {
      const m = deps.memory;
      if (!m) return void commit({ kind: 'note', text: 'There is no memory here.' });
      if (args[0] === 'forget') {
        if (!args[1]) return void commit({ kind: 'error', text: 'Use /memory forget <id>.' });
        const gone = m.store.remove(args[1]);
        return void commit({
          kind: 'note',
          text: gone ? `Forgot ${args[1]}.` : `There is no saved note ${args[1]}.`,
        });
      }
      const file = m.store.load();
      // A plain list when asked for, and when there is nothing to open a panel for.
      if (args[0] === 'list' || !file.entries.length)
        return void commit({ kind: 'note', text: plainMemory(file, m.personalise()) });
      set({ overlay: 'memory' });
    } else if (name === 'bg') {
      const prompt = args.join(' ').trim();
      if (!deps.background)
        return void commit({ kind: 'note', text: 'Background tasks are not available here.' });
      if (!prompt)
        return void commit({
          kind: 'error',
          text: 'Use /bg <task>. It runs on its own and Remy tells you when it is done.',
        });
      return deps.background.start(prompt).then(
        (id) =>
          commit({
            kind: 'note',
            text: `Started ${id} in the background. Follow it: remy attach ${id}. It shows in /sessions.`,
          }),
        (e) => commit({ kind: 'error', text: friendlyError(e) }),
      );
    } else if (name === 'tour') {
      if (!deps.startTour) return void commit({ kind: 'note', text: 'There is no tour here.' });
      deps.startTour();
    } else if (name === 'exit') set({ wantsExit: true });
    else commit({ kind: 'error', text: `There is no command /${typed}. Type / to see them.` });
  }

  const api: Chat = {
    getState: () => s,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    history: () => sent,
    noteInput: () => batch.boost(),

    async submit(raw, pasted) {
      const text = raw.trim();
      if (!text) return;
      // Pasted text is untrusted: the task starts tainted and the model sees it fenced.
      const segs = (pasted ?? []).map((p) => p.trim()).filter((p) => p && text.includes(p));
      if (segs.length) pastedFor.set(text, segs);
      if (/^\/(exit|quit)$/.test(text)) return void set({ wantsExit: true });
      if (s.phase === 'waiting_user' && current) {
        const my = gen;
        const id = current.id;
        sent.push(text);
        commit({ kind: 'user', text });
        set({ phase: 'running', thinking: true, question: undefined });
        running = true;
        try {
          await runtime.answer(id, text, segs);
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

    startTask: async (prompt, folder) => {
      if (s.phase === 'idle') await start(prompt, folder);
    },
    closePicker: () => set({ picker: undefined }),
    resume: resumeTask,
    openOverlay: (which) => set({ overlay: which }),
    closeOverlay: (only) => {
      if (!only || s.overlay === only) set({ overlay: undefined });
    },
    setTheme(choice) {
      const saved = deps.saveTheme?.(choice) ?? false;
      set({ theme: choice, overlay: undefined });
      const label = choice === 'auto' ? 'auto (follows your terminal)' : choice;
      commit({
        kind: 'note',
        text: saved ? `Theme: ${label}. Saved for next time.` : `Theme: ${label}. Not saved.`,
      });
    },
    notify(text) {
      if (s.phase === 'idle' && !s.items.length) held.push(text);
      else commit({ kind: 'note', text });
    },
    addConnection() {
      const inner = deps.addConnection;
      if (!inner) throw new Error('Connecting apps is not available here.');
      return {
        ...inner,
        async add(plan, values, hooks) {
          let line: string;
          try {
            line = await inner.add(plan, values, {
              ...hooks,
              onUrl(url, opened) {
                hooks.onUrl?.(url, opened);
                if (!opened) commit({ kind: 'note', text: `Open this link to sign in: ${url}` });
              },
            });
          } catch (e) {
            line = e instanceof Error ? e.message : String(e);
          }
          commit({ kind: 'note', text: line });
          return line;
        },
      };
    },
    connections() {
      const inner = deps.connections;
      const empty: ConnectionsApi = { list: () => [], setEnabled: () => '', remove: () => '' };
      const base = inner ?? empty;
      return {
        list: () => base.list(),
        setEnabled(name, enabled) {
          const line = base.setEnabled(name, enabled);
          if (line) commit({ kind: 'note', text: line });
          return line;
        },
        remove(name) {
          const line = base.remove(name);
          if (line) commit({ kind: 'note', text: line });
          return line;
        },
        allowed: (name) => base.allowed?.(name) ?? [],
        unallow(tool) {
          const line = base.unallow?.(tool) ?? '';
          if (line) commit({ kind: 'note', text: line });
          return line;
        },
        ...(base.signIn && {
          async signIn(name, hooks) {
            const line = await (base.signIn as NonNullable<ConnectionsApi['signIn']>)(name, {
              ...hooks,
              onUrl(url, opened) {
                hooks.onUrl?.(url, opened);
                if (!opened) commit({ kind: 'note', text: `Open this link to sign in: ${url}` });
              },
            });
            if (line) commit({ kind: 'note', text: line });
            return line;
          },
        }),
      };
    },
    async runCommand(name) {
      set({ overlay: undefined });
      await command(`/${name}`);
    },
    providers: () => deps.connect?.providers() ?? [],
    models: () => deps.connect?.models() ?? [],
    async saveLogin(entry) {
      if (!deps.connect) return { ok: false, message: 'Logins are not available here.' };
      const r = await deps.connect.login(entry);
      if (!r.ok) return r;
      if (r.model) {
        set({ model: r.model, contextWindow: r.contextWindow });
        commit({ kind: 'note', text: r.message });
        void drain();
      } else {
        // Connected, but no model is chosen yet: the model list is the next step.
        commit({ kind: 'note', text: r.message });
        set({ overlay: 'model' });
      }
      return r;
    },
    async chooseModel(provider, model) {
      if (!deps.connect) return;
      if (s.phase !== 'idle')
        return void commit({
          kind: 'note',
          text: 'Remy is working. Let it finish or press Ctrl+C, then switch with /model.',
        });
      const r = await deps.connect.use(provider, model);
      // The panel closes together with the result, so a caller watching it sees the note too.
      if (!r.ok) {
        set({ overlay: undefined });
        return void commit({ kind: 'error', text: r.message });
      }
      set({
        model: r.model ?? model,
        contextWindow: r.contextWindow,
        overlay: undefined,
        items: [...s.items, { kind: 'note', text: r.message }],
      });
      void drain();
    },
    async completeFiles(query) {
      if (!deps.files) return [];
      return completePaths(deps.files, query);
    },

    async approve(granted, note, always) {
      const a = s.approval;
      if (s.phase !== 'waiting_approval' || !a || !current) return;
      const my = gen;
      const id = current.id;
      // "Always" saves first; if that fails the call is still approved, once, and the user is told.
      const tool = s.approvalView?.always;
      const keep = Boolean(always && granted && tool);
      if (keep && tool && deps.approvals) {
        try {
          deps.approvals.add(tool, a.risk);
          commit({
            kind: 'note',
            text: `Always allowing ${tool}, in any task. Undo with /approvals.`,
          });
        } catch (e) {
          commit({
            kind: 'error',
            text: `${friendlyError(e)} Approved this once instead.`,
          });
        }
      }
      set({ phase: 'running', approval: undefined, approvalView: undefined, thinking: true });
      running = true;
      try {
        await runtime.approve(id, a.callId, a.argsHash, granted, 'user', note, keep);
        await drive(id, my);
      } catch (e) {
        if (my !== gen) return;
        await end(false, { kind: 'error', text: friendlyError(e) });
      }
    },

    async continueRun(yes) {
      const p = s.pause;
      if (s.phase !== 'paused' || !p || !current) return;
      const my = gen;
      const id = current.id;
      if (!yes)
        return await end(false, {
          kind: 'note',
          text: `Left paused. Continue any time with: remy continue ${id}`,
          ...turnMeta(),
        });
      set({ phase: 'running', pause: undefined, thinking: true });
      running = true;
      try {
        await runtime.extend(id, p.more, 'user');
        await drive(id, my);
      } catch (e) {
        if (my !== gen) return;
        await end(false, { kind: 'error', text: friendlyError(e) });
      }
    },

    interrupt: () => halt(false),

    async sendNow(text, pasted) {
      if (s.phase === 'idle') return api.submit(text, pasted);
      // The queue stays as it is, so it drains behind this message when its task ends.
      await halt(true);
      await api.submit(text, pasted);
      // A /command finishes at once and starts no task, so nothing else would send the queue.
      await drain();
    },
  };
  return api;
}

/** Releases a lease on the store for a task: used by `deps.release`. */
export const releaseLease = (store: EventStore, owner: string) => (taskId: string) =>
  store.releaseLease({ taskId, owner, expiresAt: 0 });

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ApprovalRequest,
  createRuntime,
  DEFAULT_BUDGET,
  type EventStore,
  fold,
  type ModelClient,
  RISKS,
  type Risk,
  type RunOutcome,
  TaskBusyError,
  type TaskConfig,
  type TaskStatus,
  ToolRegistry,
} from '@remy/core';
import { DEFAULT_CAPS, modelFromEnv, PROFILES } from '@remy/models';
import { SqliteEventStore } from '@remy/store';
import {
  askUser,
  braveSearch,
  calculate,
  createRedactor,
  createScopedFetch,
  createScopedFs,
  createWebSearch,
  deleteFile,
  editFile,
  fetchUrl,
  finish,
  listFiles,
  makeDir,
  moveFile,
  readFile,
  runCommand,
  searxngSearch,
  tavilySearch,
  updatePlan,
  writeFile,
} from '@remy/tools';
import { type FileConfig, loadConfig } from './config.ts';
import { createTimeline, fmtCost, styler, totalsLine, truncate } from './format.ts';

export interface CliDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  /** True when stdin and stdout are a terminal: approvals and questions are asked inline. */
  isTTY: boolean;
  /** Asks one line; null when input has ended. Required for interactive use. */
  ask?: (question: string) => Promise<string | null>;
  store?: EventStore;
  model?: ModelClient;
  /** Registers an interrupt (Ctrl-C) handler; returns a disposer. */
  onInterrupt?: (handler: () => Promise<void>) => () => void;
}

const STATUSES: TaskStatus[] = [
  'running',
  'waiting_approval',
  'waiting_user',
  'succeeded',
  'failed',
  'cancelled',
];

const HELP = `remy: tell it what you need done.

Usage
  remy run "<prompt>" [options]   Start a task and run it
  remy resume <id>                Continue a task that stopped
  remy approve <id> [--deny]      Answer a pending approval, then continue
  remy answer <id> "<text>"       Answer a pending question, then continue
  remy cancel <id>                Stop a task for good
  remy list [--status <status>]   List tasks
  remy show <id> [--json]         Show what a task did (--json prints raw events)
  remy --version | help

Options for run
  --profile <name>      openrouter, ollama or openai
  --model <id>          Model id
  --base-url <url>      Any OpenAI-compatible endpoint
  --auto <risks>        Risks approved without asking (default read). Example: read,write
  --workspace <dir>     Folder the task may read and write (default ~/.remy/workspaces/<id>)
  --max-steps <n>       Step budget (default ${DEFAULT_BUDGET.maxSteps})
  --max-cost <usd>      Cost budget (default ${DEFAULT_BUDGET.maxCostUsd})
  --net-allow <hosts>   Only allow these domains. Example: example.com,docs.example.com

Setup
  Set REMY_PROFILE and REMY_MODEL (and the profile's API key, such as OPENROUTER_API_KEY).
  Optional remy.config.json in the current folder or REMY_HOME. Flags beat env, env beats config.
  Data lives in REMY_HOME (default ~/.remy). Web search turns on with BRAVE_API_KEY,
  TAVILY_API_KEY or SEARXNG_URL.
`;

const OPTIONS = {
  profile: { type: 'string' },
  model: { type: 'string' },
  'base-url': { type: 'string' },
  auto: { type: 'string' },
  workspace: { type: 'string' },
  'max-steps': { type: 'string' },
  'max-cost': { type: 'string' },
  'net-allow': { type: 'string' },
  status: { type: 'string' },
  json: { type: 'boolean' },
  deny: { type: 'boolean' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
} as const;

const SECRET_ENV = [
  'REMY_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'BRAVE_API_KEY',
  'TAVILY_API_KEY',
];
const TOOL_SECRETS = ['BRAVE_API_KEY', 'TAVILY_API_KEY', 'SEARXNG_URL'];

const list = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function version(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    return (JSON.parse(readFileSync(url, 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export async function cli(argv: string[], deps: CliDeps): Promise<number> {
  try {
    return await run(argv, deps);
  } catch (e) {
    deps.err(`${(e instanceof Error ? e.message : String(e)).trim()}\n`);
    return 1;
  }
}

async function run(argv: string[], deps: CliDeps): Promise<number> {
  const { values: flags, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  const { env, cwd } = deps;
  const out = (s = '') => deps.out(`${s}\n`);
  const [command, ...rest] = positionals;

  if (flags.version) {
    out(`remy ${version()}`);
    return 0;
  }
  if (!command || command === 'help' || flags.help) {
    deps.out(HELP);
    return 0;
  }
  if (!['run', 'resume', 'approve', 'answer', 'cancel', 'list', 'show'].includes(command))
    throw new Error(`Unknown command "${command}". Run remy help.`);

  const home = env.REMY_HOME || join(homedir(), '.remy');
  const st = styler(deps.isTTY && !env.NO_COLOR);
  const owner = `cli-${randomUUID().slice(0, 8)}`;
  if (!deps.store) mkdirSync(home, { recursive: true });
  const ownStore = deps.store ? undefined : new SqliteEventStore(join(home, 'remy.sqlite'));
  const store: EventStore = deps.store ?? (ownStore as SqliteEventStore);
  let active: string | undefined;
  const dispose = deps.onInterrupt?.(async () => {
    if (!active) return;
    await store.releaseLease({ taskId: active, owner, expiresAt: 0 });
    out(`\nStopped. Continue with: remy resume ${active}`);
  });

  const need = (n: number, usage: string) => {
    if (rest.length < n) throw new Error(`Usage: ${usage}`);
  };
  const exists = async (id: string) => {
    const events = await store.read(id);
    if (!events.length) throw new Error(`No task named ${id}. Run remy list to see your tasks.`);
    return events;
  };

  const cfg = (): FileConfig => loadConfig(cwd, home);

  function modelFor(file: FileConfig): ModelClient {
    if (deps.model) return deps.model;
    const e: Record<string, string | undefined> = {
      ...env,
      REMY_PROFILE: flags.profile ?? env.REMY_PROFILE ?? file.profile,
      REMY_MODEL: flags.model ?? env.REMY_MODEL ?? file.model,
      REMY_BASE_URL: flags['base-url'] ?? env.REMY_BASE_URL ?? file.baseUrl,
    };
    if (!e.REMY_PROFILE && !e.REMY_BASE_URL)
      throw new Error(
        `No model is configured. Set REMY_PROFILE to one of ${Object.keys(PROFILES).join(', ')} and REMY_MODEL, or pass --profile and --model.`,
      );
    if (!e.REMY_MODEL) throw new Error('No model is chosen. Set REMY_MODEL or pass --model.');
    const keyEnv = e.REMY_PROFILE ? PROFILES[e.REMY_PROFILE]?.keyEnv : undefined;
    if (keyEnv && !e.REMY_API_KEY && !e[keyEnv])
      throw new Error(`The ${e.REMY_PROFILE} profile needs an API key. Set ${keyEnv}.`);
    return modelFromEnv(e);
  }

  function makeRuntime(file: FileConfig, opts: { model: boolean; taskId?: string }) {
    const model: ModelClient = opts.model
      ? modelFor(file)
      : {
          id: 'none',
          caps: DEFAULT_CAPS,
          complete: async () => {
            throw new Error('No model is needed for this command.');
          },
        };
    // Every task has a workspace, so the file tools and run_command are always available.
    const tools = new ToolRegistry([
      readFile,
      writeFile,
      editFile,
      moveFile,
      deleteFile,
      makeDir,
      listFiles,
      runCommand,
      calculate,
      updatePlan,
      fetchUrl,
      askUser,
      finish,
    ]);
    if (env.BRAVE_API_KEY) tools.add(createWebSearch(braveSearch(env.BRAVE_API_KEY)));
    else if (env.TAVILY_API_KEY) tools.add(createWebSearch(tavilySearch(env.TAVILY_API_KEY)));
    else if (env.SEARXNG_URL) tools.add(createWebSearch(searxngSearch(env.SEARXNG_URL)));
    const secrets: Record<string, string> = {};
    for (const k of SECRET_ENV) if (env[k]) secrets[k] = env[k];
    const timeline = createTimeline(st, { live: true });
    let pre = opts.taskId;
    const runtime = createRuntime({
      store,
      model,
      tools,
      owner,
      redact: createRedactor(secrets),
      ids: {
        next: (p) => {
          if (p === 'task' && pre) {
            const id = pre;
            pre = undefined;
            return id;
          }
          return `${p}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        },
      },
      capabilities: (config) => {
        mkdirSync(config.workspaceDir, { recursive: true });
        return {
          fs: createScopedFs(config.workspaceDir),
          net: createScopedFetch(
            config.permissions.netAllow ? { allow: config.permissions.netAllow } : {},
          ),
          secrets: { get: (n) => (TOOL_SECRETS.includes(n) ? env[n] : undefined) },
        };
      },
      onEvent: (e) => {
        const line = timeline.line(e);
        if (line) out(line);
      },
    });
    return { runtime, timeline };
  }
  type Rt = ReturnType<typeof makeRuntime>['runtime'];

  const followUp = (id: string, o: Extract<RunOutcome, { status: `waiting_${string}` }>) => {
    if (o.status === 'waiting_approval') {
      out(`${st.bold('Approval needed:')} ${o.request.preview}`);
      out(st.dim(`Risk: ${o.request.risk}. Why: ${o.request.reason}`));
      out(`Approve: ${st.accent(`remy approve ${id}`)}`);
      out(`Deny:    ${st.accent(`remy approve ${id} --deny`)}`);
    } else {
      out(`${st.bold('Question:')} ${o.question}`);
      out(`Answer: ${st.accent(`remy answer ${id} "<your answer>"`)}`);
    }
  };

  async function finishLine(
    rt: Rt,
    id: string,
    o: Exclude<RunOutcome, { status: `waiting_${string}` }>,
  ) {
    if (o.status === 'succeeded') out(o.answer?.trim() || 'Done.');
    else if (o.status === 'failed') out(`Failed: ${o.reason ?? 'the task could not finish.'}`);
    else out(`Cancelled. ${o.reason ?? ''}`.trim());
    const s = await rt.state(id);
    out(st.dim(`${id}, ${s.step} steps, ${fmtCost(s.costUsd)}. Details: remy show ${id}`));
    return o.status === 'failed' ? 1 : 0;
  }

  // A run that died without cleaning up holds the lease until it expires (15s).
  async function advanceWhenFree(rt: Rt, id: string) {
    for (let waited = 0; ; waited += 1000) {
      try {
        return await rt.advance(id);
      } catch (e) {
        if (!(e instanceof TaskBusyError) || waited >= 20_000) throw e;
        if (waited === 0) out(st.dim('Another run holds this task. Waiting for it to free up.'));
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async function drive(rt: Rt, id: string): Promise<number> {
    active = id;
    for (;;) {
      const o = await advanceWhenFree(rt, id);
      if (o.status === 'waiting_approval' || o.status === 'waiting_user') {
        if (!deps.isTTY || !deps.ask) {
          followUp(id, o);
          return 0;
        }
        if (o.status === 'waiting_approval') {
          const r: ApprovalRequest = o.request;
          out();
          out(`${st.bold('Approval needed:')} ${r.preview}`);
          out(st.dim(`Risk: ${r.risk}. Why: ${r.reason}`));
          const a = await deps.ask('Approve? [y/N] ');
          if (a === null) {
            followUp(id, o);
            return 0;
          }
          await rt.approve(id, r.callId, r.argsHash, /^y(es)?$/i.test(a.trim()), 'user');
        } else {
          out();
          out(`${st.bold('Question:')} ${o.question}`);
          const a = await deps.ask('> ');
          if (a === null || !a.trim()) {
            followUp(id, o);
            return 0;
          }
          await rt.answer(id, a.trim());
        }
        continue;
      }
      return finishLine(rt, id, o);
    }
  }

  async function resumeFlow(id: string, before?: (rt: Rt) => Promise<void>) {
    const events = await exists(id);
    const { runtime, timeline } = makeRuntime(cfg(), { model: true });
    timeline.seed(events);
    if (before) await before(runtime);
    return drive(runtime, id);
  }

  try {
    switch (command) {
      case 'run': {
        const prompt = rest.join(' ').trim();
        if (!prompt) throw new Error('Usage: remy run "<prompt>"');
        const file = cfg();
        const id = `task_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const { runtime } = makeRuntime(file, { model: true, taskId: id });
        const auto = flags.auto !== undefined ? list(flags.auto) : file.autoApprove;
        const autoApprove = (auto ?? ['read']).map((r) => {
          if (!RISKS.includes(r as Risk))
            throw new Error(`Unknown risk "${r}" in --auto. Choose from ${RISKS.join(', ')}.`);
          return r as Risk;
        });
        const num = (v: string | undefined, name: string) => {
          if (v === undefined) return undefined;
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
          return n;
        };
        const maxSteps = num(flags['max-steps'], '--max-steps');
        const maxCostUsd = num(flags['max-cost'], '--max-cost');
        const netAllow = list(flags['net-allow']) ?? file.netAllow;
        const model = deps.model ?? modelFor(file);
        const config: TaskConfig = {
          model: model.id,
          permissions: { autoApprove, ...(netAllow && { netAllow }) },
          budget: {
            ...DEFAULT_BUDGET,
            ...file.budget,
            ...(maxSteps && { maxSteps }),
            ...(maxCostUsd && { maxCostUsd }),
          },
          workspaceDir: flags.workspace
            ? resolve(cwd, flags.workspace)
            : join(home, 'workspaces', id),
        };
        mkdirSync(config.workspaceDir, { recursive: true });
        await runtime.start(prompt, config);
        out(st.dim(`Task ${id}. Workspace ${config.workspaceDir}`));
        return await drive(runtime, id);
      }

      case 'resume':
        need(1, 'remy resume <id>');
        return await resumeFlow(rest[0] as string);

      case 'approve': {
        need(1, 'remy approve <id> [--deny]');
        const id = rest[0] as string;
        return await resumeFlow(id, async (rt) => {
          const p = (await rt.state(id)).pendingApproval;
          if (!p) throw new Error(`Task ${id} has no approval waiting.`);
          await rt.approve(id, p.callId, p.argsHash, !flags.deny, 'user');
          out(st.dim(`${flags.deny ? 'Denied' : 'Approved'}: ${p.preview}`));
        });
      }

      case 'answer': {
        need(2, 'remy answer <id> "<text>"');
        const id = rest[0] as string;
        const text = rest.slice(1).join(' ');
        return await resumeFlow(id, async (rt) => {
          if (!(await rt.state(id)).pendingQuestion)
            throw new Error(`Task ${id} has no question waiting.`);
          await rt.answer(id, text);
        });
      }

      case 'cancel': {
        need(1, 'remy cancel <id>');
        const id = rest[0] as string;
        await exists(id);
        const { runtime } = makeRuntime({}, { model: false });
        const before = await runtime.state(id);
        if (before.final) out(`Task ${id} already ${before.final.status}.`);
        else {
          await runtime.cancel(id, 'user');
          out(`Cancelled ${id}.`);
        }
        return 0;
      }

      case 'list': {
        const status = flags.status as TaskStatus | undefined;
        if (status && !STATUSES.includes(status))
          throw new Error(`Unknown status "${status}". Choose from ${STATUSES.join(', ')}.`);
        const tasks = await store.listTasks(status ? { status } : undefined);
        if (!tasks.length) {
          out(status ? `No ${status} tasks.` : 'No tasks yet. Start one with remy run "<prompt>".');
          return 0;
        }
        const w = Math.max(...tasks.map((t) => t.status.length));
        for (const t of tasks)
          out(
            `${t.taskId}  ${t.status.padEnd(w)}  ${st.dim(t.createdAt.slice(0, 16).replace('T', ' '))}  ${truncate(t.prompt, 60)}`,
          );
        return 0;
      }

      case 'show': {
        need(1, 'remy show <id> [--json]');
        const id = rest[0] as string;
        const events = await exists(id);
        if (flags.json) {
          deps.out(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
          return 0;
        }
        const s = fold(events);
        out(`${st.bold(`Task ${id}`)}  ${s.status}`);
        out(st.dim(`Prompt: ${truncate(s.prompt, 200)}`));
        out(st.dim(`Model: ${s.config.model}. Workspace: ${s.config.workspaceDir}`));
        out();
        const tl = createTimeline(st, { live: false });
        for (const e of events) {
          const line = tl.line(e);
          if (line) out(line);
        }
        out();
        out(totalsLine(events, s, st));
        if (s.final?.answer) out(`\n${s.final.answer.trim()}`);
        else if (s.final?.reason) out(`\n${s.final.reason}`);
        return 0;
      }
    }
    return 0;
  } finally {
    dispose?.();
    ownStore?.close();
  }
}

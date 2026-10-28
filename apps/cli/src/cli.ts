import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ApprovalRequest,
  type ConversationTurn,
  canStandingAllow,
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
import type { McpConnectionOptions } from '@remy/mcp';
import { BUILTIN_CATALOG, DEFAULT_CAPS, modelFromEnv, PROFILES, resolveCaps } from '@remy/models';
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
import { type ApprovalsStore, openApprovals, plainApprovals } from './approvals.ts';
import {
  type ConnectApi,
  createChat,
  type ModelChoice,
  type RuntimeHooks,
  releaseLease,
} from './chat.ts';
import { type FileConfig, loadConfig } from './config.ts';
import { connectCommand } from './connect.ts';
import type { ConnectionsApi } from './connections-view.ts';
import { type Credentials, openCredentials } from './credentials.ts';
import { debugModel, openDebug } from './debug.ts';
import { createTimeline, fmtCost, styler, totalsLine, truncate } from './format.ts';
import {
  defaultModelFor,
  listLogins,
  providerChoices,
  SUGGESTED_MODELS,
  saveLogin,
} from './login.ts';
import { type McpHost, startMcp } from './mcp-host.ts';
import { importSources } from './mcp-import.ts';
import { openSecretStore, type SecretStore } from './mcp-secrets.ts';
import { createOnboarding, type Onboarding } from './onboarding-flow.ts';
import { loadPrefs, savePrefs, type ThemeChoice } from './prefs.ts';
import { createProfileStore, profileContext } from './profile.ts';
import { stdoutGate } from './stream.ts';
import { createTheme, detectColor } from './theme.ts';

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
  /** Saved logins; default is the Keychain or REMY_HOME. */
  credentials?: Credentials;
  /** Reads all of stdin (for `remy login <provider> --key-stdin`). */
  readStdin?: () => Promise<string>;
  fetch?: typeof fetch;
  /** Secrets for connected servers; default is the Keychain or REMY_HOME. */
  secrets?: SecretStore;
  /** Asks for a value without echoing it (`remy connect add --secret`). */
  askSecret?: (question: string) => Promise<string | null>;
  /** The user's real home folder, where other apps keep their MCP servers. Default os.homedir(). */
  homeDir?: string;
  /** Reads a file as text for `remy connect --import`; undefined when it is missing. */
  readText?: (path: string) => string | undefined;
  /** Replaces the MCP transports (tests). */
  mcpOptions?: (name: string) => McpConnectionOptions;
  /** How long startup waits for MCP servers (tests). */
  mcpBudgetMs?: number;
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

const help = () => `remy: tell it what you need done.

Usage
  remy                            Open the chat (in a terminal)
  remy run "<prompt>" [options]   Start a task and run it
  remy resume <id>                Continue a task that stopped
  remy approve <id> [--always | --deny [--note "<why>"]]
                                  Answer a pending approval, then continue; a note
                                  goes to the model with the denial; --always also
                                  allows that tool for good (writes and sends only)
  remy approvals [list|remove <tool>]
                                  See the tools you always allow, or stop allowing one
  remy answer <id> "<text>"       Answer a pending question, then continue
  remy cancel <id>                Stop a task for good
  remy list [--status <status>]   List tasks
  remy show <id> [--json]         Show what a task did (--json prints raw events)
  remy login [<provider> --key-stdin [--model <id>] [--base-url <url>]]
                                  Connect a provider: pick one, paste the key, done
  remy login --list               Show saved logins (never the keys)
  remy logout <provider>          Forget a saved login
  remy connect add|list|remove    Connect apps and services through MCP servers; --import
                                  brings in the ones Claude Desktop or Claude Code already use
  remy --version | help

Options for run
  --profile <name>      ${Object.keys(PROFILES).join(', ')}
  --model <id>          Model id
  --base-url <url>      Any OpenAI-compatible endpoint
  --auto <risks>        Risks approved without asking (default read). Example: read,write
  --workspace <dir>     Folder the task may read and write (default ~/.remy/workspaces/<id>)
  --max-steps <n>       Step budget (default ${DEFAULT_BUDGET.maxSteps})
  --max-cost <usd>      Cost budget (default ${DEFAULT_BUDGET.maxCostUsd})
  --net-allow <hosts>   Only allow these domains. Example: example.com,docs.example.com

Options for every command
  --debug               Log model requests, model responses and events as JSON lines.
                        They go to stderr, or in the chat to REMY_HOME/debug-<time>.jsonl.
                        REMY_DEBUG=1 does the same; REMY_DEBUG=<path> picks the file.
  --reduced-motion      No animation in the chat (also REMY_REDUCED_MOTION=1)
  --minimal             A quiet scrolling chat instead of the full screen (also REMY_SCREEN=minimal;
                        /minimal in the chat saves the choice)

Options for connect
  --url <url>  --header K=V  --env K=V  --secret KEY  --secret-stdin  --yes  --import
  Run remy connect for the full usage.

Chat
  Type a message and press Enter. Type / for commands (/model, /login, /connections, /sessions), Ctrl+P for the
  command palette, @ to attach a file from the workspace. Ctrl+C stops a running task, Ctrl+D quits.
  With nothing connected yet, remy opens on the login panel.
  NO_COLOR or FORCE_COLOR=0 turns color off; terminals without truecolor get 16 colors.

Setup
  Run remy login once. The key goes in the macOS Keychain, or a private file in REMY_HOME.
  Or set REMY_PROFILE and REMY_MODEL with the profile's API key, such as OPENROUTER_API_KEY.
  Optional remy.config.json in the current folder or REMY_HOME. Its "mcpServers" (the same shape
  as Claude Desktop's) are merged with the servers remy connect saved in REMY_HOME/connections.json;
  a config entry replaces a saved one with the same name. A token can be written as
  "\${secret:<name>}" and kept in the Keychain. Servers start with Remy; one that is slow or fails
  never holds Remy up.
  Flags beat env, env beats a saved login, a saved login beats the config file.
  REMY_KEYCHAIN=off keeps keys in a private file instead of the Keychain.
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
  list: { type: 'boolean' },
  'key-stdin': { type: 'boolean' },
  url: { type: 'string' },
  header: { type: 'string', multiple: true },
  env: { type: 'string', multiple: true },
  secret: { type: 'string', multiple: true },
  'secret-stdin': { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  import: { type: 'boolean' },
  status: { type: 'string' },
  json: { type: 'boolean' },
  debug: { type: 'boolean' },
  'reduced-motion': { type: 'boolean' },
  minimal: { type: 'boolean' },
  // Hidden alias of --minimal, kept for one release.
  classic: { type: 'boolean' },
  deny: { type: 'boolean' },
  always: { type: 'boolean' },
  note: { type: 'string' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
} as const;

const SECRET_ENV = [
  'REMY_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
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
  const chatMode = !command && deps.isTTY && !flags.help;
  if (!chatMode && (!command || command === 'help' || flags.help)) {
    deps.out(help());
    return 0;
  }
  if (
    command &&
    ![
      'run',
      'resume',
      'approve',
      'answer',
      'cancel',
      'list',
      'show',
      'login',
      'logout',
      'connect',
      'approvals',
    ].includes(command)
  )
    throw new Error(`Unknown command "${command}". Run remy help.`);

  const home = env.REMY_HOME || join(homedir(), '.remy');
  const level = detectColor(env, deps.isTTY);
  const st = styler(level);
  const owner = `cli-${randomUUID().slice(0, 8)}`;

  let creds: Credentials | undefined;
  const credentials = () => {
    creds ??=
      deps.credentials ??
      openCredentials({ home, ...(env.REMY_KEYCHAIN === 'off' && { platform: 'linux' as const }) });
    return creds;
  };

  let standingStore: ApprovalsStore | undefined;
  let standingWarned = false;
  const standing = () => {
    standingStore ??= openApprovals(home);
    return standingStore;
  };
  /** Tool names the user always allows. A damaged file turns them off, with one note. */
  const standingNames = (): string[] => {
    const s = standing().load();
    if (s.note && !standingWarned) {
      standingWarned = true;
      deps.err(`${st.dim(s.note)}\n`);
    }
    return s.entries.map((e) => e.tool);
  };

  let secretStore: SecretStore | undefined;
  const secretsFor = () => {
    secretStore ??=
      deps.secrets ??
      openSecretStore({
        home,
        ...(env.REMY_KEYCHAIN === 'off' && { platform: 'linux' as const }),
      });
    return secretStore;
  };

  if (command === 'login' || command === 'logout') return await loginCommands(command);
  if (command === 'connect') {
    const dash = argv.indexOf('--');
    const homeDir = deps.homeDir ?? homedir();
    return await connectCommand({
      rest,
      flags,
      commandArgs: dash >= 0 ? argv.slice(dash + 1) : undefined,
      home,
      cwd,
      secrets: secretsFor(),
      fromConfig: loadConfig(cwd, home).mcpServers ?? {},
      sources: importSources(homeDir, cwd, process.platform),
      readText:
        deps.readText ??
        ((path) => {
          try {
            return readFileSync(path, 'utf8');
          } catch {
            return undefined;
          }
        }),
      isTTY: deps.isTTY,
      ask: deps.ask,
      askSecret: deps.askSecret,
      readStdin: deps.readStdin,
      out,
    });
  }
  if (!deps.store) mkdirSync(home, { recursive: true });
  const ownStore = deps.store ? undefined : new SqliteEventStore(join(home, 'remy.sqlite'));
  const store: EventStore = deps.store ?? (ownStore as SqliteEventStore);
  let active: string | undefined;
  /** Connected MCP servers; started by the first runtime that needs a model. */
  let mcp: McpHost | undefined;
  const dispose = deps.onInterrupt?.(async () => {
    await mcp?.close();
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

  async function loginCommands(which: 'login' | 'logout'): Promise<number> {
    const store = credentials();
    const known = [...Object.keys(PROFILES), 'custom'];
    const [provider] = rest;
    if (which === 'logout') {
      if (!provider) throw new Error('Usage: remy logout <provider>');
      out(
        store.remove(provider)
          ? `Forgot the ${provider} login.`
          : `No saved login for ${provider}. Run remy login --list.`,
      );
      return 0;
    }
    if (flags.list) {
      for (const line of listLogins(store)) out(line);
      return 0;
    }
    if (provider || flags['key-stdin']) {
      if (!provider || !known.includes(provider))
        throw new Error(
          `Usage: remy login <provider> --key-stdin. Providers: ${known.join(', ')}.`,
        );
      if (!flags['key-stdin'] && PROFILES[provider]?.keyEnv)
        throw new Error(
          `Run remy login to pick a provider and paste the key, or pipe it: remy login ${provider} --key-stdin.`,
        );
      const key = flags['key-stdin'] ? ((await deps.readStdin?.()) ?? '').trim() : '';
      const baseUrl = flags['base-url'];
      const result = await saveLogin(
        { credentials: store, ...(deps.fetch && { fetch: deps.fetch }) },
        {
          provider,
          key,
          ...(baseUrl && { baseUrl }),
          ...(flags.model && { model: flags.model }),
        },
      );
      if (!result.ok) throw new Error(result.message);
      out(result.message);
      return 0;
    }
    if (!deps.isTTY)
      throw new Error(
        'remy login needs a terminal. Pipe a key instead: remy login <provider> --key-stdin.',
      );
    const { runLogin } = await import('./login-ui.ts');
    await runLogin({
      providers: providerChoices(),
      theme: createTheme(level),
      onSubmit: (entry) =>
        saveLogin({ credentials: store, ...(deps.fetch && { fetch: deps.fetch }) }, entry),
    });
    return 0;
  }

  const cfg = (): FileConfig => loadConfig(cwd, home);

  const secrets: Record<string, string> = {};
  for (const k of SECRET_ENV) if (env[k]) secrets[k] = env[k];
  let redactor = createRedactor(secrets);
  const redact = (text: string) => redactor(text);
  const addSecret = (name: string, value: string) => {
    secrets[name] = value;
    redactor = createRedactor(secrets);
  };
  const debug = openDebug({
    flag: Boolean(flags.debug),
    env: env.REMY_DEBUG,
    home,
    cwd,
    chat: chatMode,
    stderr: deps.err,
    redact,
  });
  if (debug && debug.target !== 'stderr') deps.err(`Debug log: ${debug.target}\n`);

  function modelFor(file: FileConfig): ModelClient {
    if (deps.model) return deps.model;
    // Per field: flags, then env, then a saved login, then remy.config.json.
    const explicitUrl = flags['base-url'] ?? env.REMY_BASE_URL;
    const named = flags.profile ?? env.REMY_PROFILE;
    const profileName =
      named ?? (explicitUrl ? undefined : credentials().defaultProvider()) ?? file.profile;
    const saved = profileName ? credentials().load(profileName) : undefined;
    if (saved?.key) addSecret(`${profileName}_LOGIN_KEY`, saved.key);
    const e: Record<string, string | undefined> = {
      ...env,
      REMY_PROFILE: profileName === 'custom' ? undefined : profileName,
      REMY_MODEL:
        flags.model ??
        env.REMY_MODEL ??
        saved?.model ??
        file.model ??
        (profileName ? defaultModelFor(profileName) : undefined),
      REMY_BASE_URL: explicitUrl ?? saved?.baseUrl ?? file.baseUrl,
    };
    if (!e.REMY_PROFILE && !e.REMY_BASE_URL)
      throw new Error(
        'Remy needs a model first. Run remy login to connect one, or set REMY_PROFILE and REMY_MODEL.',
      );
    if (!e.REMY_MODEL)
      throw new Error(
        'No model is chosen. Pass --model <id> or set REMY_MODEL, or run remy login again and name a default.',
      );
    const keyEnv = e.REMY_PROFILE ? PROFILES[e.REMY_PROFILE]?.keyEnv : undefined;
    if (saved?.key && !e.REMY_API_KEY && !(keyEnv && e[keyEnv])) e.REMY_API_KEY = saved.key;
    if (keyEnv && !e.REMY_API_KEY && !e[keyEnv])
      throw new Error(
        `The ${e.REMY_PROFILE} profile needs an API key. Run remy login, or set ${keyEnv}.`,
      );
    return modelFromEnv(e);
  }

  /** Starts the connected servers once per process. Trouble with the config never stops Remy. */
  function mcpHost(file: FileConfig, quiet: boolean): McpHost | undefined {
    if (mcp) return mcp;
    try {
      mcp = startMcp({
        home,
        fromConfig: file.mcpServers,
        secrets: secretsFor(),
        redact,
        addSecret,
        ...(deps.mcpOptions && { options: deps.mcpOptions }),
        ...(deps.mcpBudgetMs !== undefined && { budgetMs: deps.mcpBudgetMs }),
        debug: (event, data) => debug?.write(event, data),
      });
    } catch (e) {
      deps.err(`${st.dim(`Connections are off: ${redact(String((e as Error).message))}`)}\n`);
      return undefined;
    }
    if (!quiet) mcp.onNote((n) => deps.err(`${st.dim(n)}\n`));
    return mcp;
  }

  function makeRuntime(
    file: FileConfig,
    opts: { model: boolean | ModelClient; taskId?: string; hooks?: Partial<RuntimeHooks> },
  ) {
    const base: ModelClient = opts.model
      ? typeof opts.model === 'object'
        ? opts.model
        : modelFor(file)
      : {
          id: 'none',
          caps: DEFAULT_CAPS,
          complete: async () => {
            throw new Error('No model is needed for this command.');
          },
        };
    const model = debug ? debugModel(base, debug) : base;
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
    // Commands that never call a model (cancel) do not start the servers.
    if (opts.model) mcpHost(file, Boolean(opts.hooks))?.attach(tools);
    const timeline = createTimeline(st, { live: true });
    let pre = opts.taskId;
    const runtime = createRuntime({
      store,
      model,
      tools,
      owner,
      redact,
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
        debug?.write('event', e);
        opts.hooks?.onEvent?.(e);
        if (opts.hooks) return;
        const line = timeline.line(e);
        if (line) out(line);
      },
      ...(opts.hooks?.onText && { onText: opts.hooks.onText }),
      ...(opts.hooks?.onReasoning && { onReasoning: opts.hooks.onReasoning }),
      ...(opts.hooks?.onModelStart && { onModelStart: opts.hooks.onModelStart }),
    });
    return { runtime, timeline, tools };
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
          const tool = (await rt.state(id)).calls[r.callId]?.tool ?? '';
          const can = canStandingAllow(r.risk) && tool !== '';
          if (can)
            out(
              st.dim(
                `a approves and always allows ${tool}, in any task. Undo: remy approvals remove ${tool}`,
              ),
            );
          const a = await deps.ask(can ? 'Approve? [y/N/a] ' : 'Approve? [y/N] ');
          if (a === null) {
            followUp(id, o);
            return 0;
          }
          const always = can && /^a(lways)?$/i.test(a.trim());
          if (always) {
            standing().add(tool, r.risk);
            out(st.dim(`Always allowing ${tool}.`));
          }
          const yes = always || /^y(es)?$/i.test(a.trim());
          await rt.approve(id, r.callId, r.argsHash, yes, 'user', undefined, always);
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
    await mcp?.ready;
    timeline.seed(events);
    if (before) await before(runtime);
    return drive(runtime, id);
  }

  /** The task config shared by `run` and the chat: flags beat the config file, which beats defaults. */
  function taskConfig(
    file: FileConfig,
    modelId: string,
    workspaceDir: string,
    context?: ConversationTurn[],
  ): TaskConfig {
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
    const always = standingNames();
    return {
      model: modelId,
      permissions: {
        autoApprove,
        ...(netAllow && { netAllow }),
        ...(always.length && { standing: always }),
      },
      budget: {
        ...DEFAULT_BUDGET,
        ...file.budget,
        ...(maxSteps && { maxSteps }),
        ...(maxCostUsd && { maxCostUsd }),
      },
      workspaceDir,
      ...(context?.length && { context }),
    };
  }

  /** A client for a saved login and a model id, used when switching inside the chat. */
  function clientFor(provider: string, modelId: string): ModelClient {
    const saved = credentials().load(provider);
    const profile = provider === 'custom' ? undefined : PROFILES[provider];
    if (!profile && provider !== 'custom') throw new Error(`Unknown provider "${provider}".`);
    if (saved?.key) addSecret(`${provider}_LOGIN_KEY`, saved.key);
    const key = saved?.key || (profile?.keyEnv ? env[profile.keyEnv] : undefined);
    if ((profile?.keyEnv || provider === 'custom') && !key)
      throw new Error(`There is no key for ${provider}. Run /login to add one.`);
    return modelFromEnv({
      ...env,
      REMY_PROFILE: profile ? provider : undefined,
      REMY_MODEL: modelId,
      REMY_BASE_URL: saved?.baseUrl,
      REMY_API_KEY: key,
    });
  }

  const usd = (n: number) => `$${n >= 10 ? n : n.toFixed(2)}`;
  const priceWord = (id: string, provider: string) => {
    const c = resolveCaps(id, BUILTIN_CATALOG);
    const listed = id in BUILTIN_CATALOG;
    const price =
      c.pricing.inPerMTok || c.pricing.outPerMTok
        ? `${usd(c.pricing.inPerMTok)} in, ${usd(c.pricing.outPerMTok)} out per M`
        : provider === 'ollama'
          ? 'free, runs here'
          : listed
            ? 'free'
            : 'price not listed';
    return listed
      ? `${price} · ${Math.round((c.contextWindow ?? c.contextTokens) / 1000)}k context`
      : price;
  };

  async function chatFlow(): Promise<number> {
    const file = cfg();
    let first: ModelClient | undefined;
    let activeProvider: string | undefined;
    try {
      first = deps.model ?? modelFor(file);
      activeProvider = flags.profile ?? env.REMY_PROFILE ?? credentials().defaultProvider();
    } catch (e) {
      // Nothing connected yet: the chat opens on the login panel instead of exiting.
      if (!/needs a model first|needs an API key|No model is chosen/.test(String(e))) throw e;
    }
    let active = first;
    // Name and goals reach the user's own model as one line, only when they agreed.
    const profile = createProfileStore(home);
    // The runtime holds this stand-in, so /model can swap the real client under it.
    const model: ModelClient = {
      get id() {
        return active?.id ?? 'none';
      },
      get caps() {
        return active?.caps ?? DEFAULT_CAPS;
      },
      complete(req, ...a) {
        if (!active) throw new Error('No model is connected. Run /login.');
        const note = profileContext(profile.get());
        return active.complete(note ? { ...req, system: `${req.system}\n\n${note}` } : req, ...a);
      },
    };
    // One workspace for the whole conversation, so files made in one turn are there in the next.
    const workspace = flags.workspace
      ? resolve(cwd, flags.workspace)
      : join(home, 'workspaces', `chat_${randomUUID().replaceAll('-', '').slice(0, 12)}`);
    taskConfig(file, model.id, workspace); // fail on bad flags before the screen opens
    mkdirSync(workspace, { recursive: true });
    const wsFs = createScopedFs(workspace);
    const switchTo = (provider: string, modelId: string) => {
      active = clientFor(provider, modelId);
      activeProvider = provider;
      const saved = credentials().load(provider);
      // Remember the choice: the next `remy` starts on it.
      credentials().save(provider, saved?.key ?? '', {
        model: modelId,
        ...(saved?.baseUrl && { baseUrl: saved.baseUrl }),
      });
      return { model: active.id, contextWindow: active.caps.contextWindow };
    };
    const connect: ConnectApi = {
      providers: providerChoices,
      models() {
        const rows = new Map<string, ModelChoice>();
        const add = (provider: string, id: string | undefined) => {
          if (id && !rows.has(`${provider}\t${id}`))
            rows.set(`${provider}\t${id}`, {
              provider,
              model: id,
              detail: priceWord(id, provider),
            });
        };
        if (activeProvider && active) add(activeProvider, active.id);
        for (const l of credentials().list()) {
          add(l.provider, credentials().load(l.provider)?.model);
          for (const id of SUGGESTED_MODELS[l.provider] ?? []) add(l.provider, id);
        }
        return [...rows.values()];
      },
      async login(entry) {
        const r = await saveLogin(
          { credentials: credentials(), ...(deps.fetch && { fetch: deps.fetch }) },
          entry,
        );
        if (!r.ok) return r;
        const wanted = entry.model || defaultModelFor(entry.provider);
        const message = r.message.replace(/ Run remy to start\.$/, '');
        if (!wanted) return { ok: true, message: `${message} Pick a model next.` };
        try {
          const done = switchTo(entry.provider, wanted);
          return { ok: true, message: `${message} Using ${wanted}.`, ...done };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      },
      async use(provider, modelId) {
        try {
          const done = switchTo(provider, modelId);
          return {
            ok: true,
            message: `Now using ${modelId} on ${provider}. The conversation carries over.`,
            ...done,
          };
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          return { ok: false, message: `Could not switch to ${modelId}: ${why}` };
        }
      },
    };
    let registry: ToolRegistry | undefined;
    const prefs = loadPrefs(home);
    // The flag and REMY_SCREEN win over the saved choice; REMY_SCREEN=full turns a saved one off.
    const minimal =
      flags.minimal ||
      flags.classic ||
      env.REMY_SCREEN === 'minimal' ||
      env.REMY_SCREEN === 'classic' ||
      (Boolean(prefs.minimal) && env.REMY_SCREEN !== 'full');
    let onboarding: Onboarding | undefined;
    const chat = createChat({
      ...(process.stdout.isTTY && { gate: stdoutGate(process.stdout) }),
      profileEnabled: true,
      startTour: () => onboarding?.start(),
      theme: prefs.theme ?? 'auto',
      saveTheme: (choice) => savePrefs(home, { theme: choice }),
      newClears: !minimal,
      minimal: prefs.minimal ?? false,
      saveMinimal: (on) => savePrefs(home, { minimal: on }),
      runtime: (hooks) => {
        const made = makeRuntime(file, { model, hooks });
        registry = made.tools;
        return made.runtime;
      },
      effectOf: (tool) => registry?.get(tool)?.effect,
      riskOf: (tool) => registry?.get(tool)?.risk,
      approvals: standing(),
      config: (context) => taskConfig(file, model.id, workspace, context),
      listTasks: () => store.listTasks(),
      readEvents: (id) => store.read(id),
      release: releaseLease(store, owner),
      ...(first && { model: first.id, contextWindow: first.caps.contextWindow }),
      connect,
      connections: {
        list: () => mcp?.list() ?? [],
        setEnabled: (name, on) => mcp?.setEnabled(name, on) ?? '',
        remove: (name) => mcp?.remove(name) ?? '',
        allowed: (server) =>
          standing()
            .names()
            .filter((n) => n.startsWith(`${server}__`)),
        unallow: (tool) =>
          standing().remove(tool)
            ? `${tool} asks again from now on.`
            : `${tool} is not on the list.`,
      } satisfies ConnectionsApi,
      ready: () => mcp?.ready ?? Promise.resolve(),
      files: {
        list: (p) => wsFs.list(p),
        async read(p) {
          const text = await wsFs.readText(p).catch(() => undefined);
          return text === undefined || text.includes('\0') ? undefined : text;
        },
      },
    });
    // Failed servers are told once, quietly, in the transcript.
    mcp?.onNote((note) => chat.notify(note));
    onboarding = createOnboarding({
      chat,
      profile,
      markDone: () => void savePrefs(home, { onboarded: true }),
      scratchDir: () =>
        join(home, 'workspaces', `tour_${randomUUID().replaceAll('-', '').slice(0, 12)}`),
    });
    if (!prefs.onboarded) onboarding.start();
    const { runChat } = await import('./chat-ui.ts');
    const { probeTerminal } = await import('./terminal.ts');
    // One quick question to the terminal before the screen opens: frame sync and light or dark.
    const probe = await probeTerminal(env, process.stdin, process.stdout);
    const themeFor = (choice: ThemeChoice) =>
      createTheme(level, choice === 'auto' ? probe.background : choice);
    await runChat({
      chat,
      profile,
      onboarding,
      sync: probe.sync,
      env,
      onStray: debug ? (stream, text) => debug.write('stray', { stream, text }) : undefined,
      theme: themeFor(prefs.theme ?? 'auto'),
      themeFor,
      reducedMotion: Boolean(flags['reduced-motion']) || env.REMY_REDUCED_MOTION === '1',
      ...(minimal && { screen: 'minimal' as const }),
      ...(first && { subtitle: first.id }),
      workspace,
      version: version(),
    });
    return 0;
  }

  try {
    if (chatMode) return await chatFlow();
    switch (command) {
      case 'run': {
        const prompt = rest.join(' ').trim();
        if (!prompt) throw new Error('Usage: remy run "<prompt>"');
        const file = cfg();
        const id = `task_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const { runtime } = makeRuntime(file, { model: true, taskId: id });
        const model = deps.model ?? modelFor(file);
        const config = taskConfig(
          file,
          model.id,
          flags.workspace ? resolve(cwd, flags.workspace) : join(home, 'workspaces', id),
        );
        mkdirSync(config.workspaceDir, { recursive: true });
        await mcp?.ready;
        await runtime.start(prompt, config);
        out(st.dim(`Task ${id}. Workspace ${config.workspaceDir}`));
        return await drive(runtime, id);
      }

      case 'resume':
        need(1, 'remy resume <id>');
        return await resumeFlow(rest[0] as string);

      case 'approve': {
        need(1, 'remy approve <id> [--always | --deny [--note "<why>"]]');
        const id = rest[0] as string;
        const note = flags.note?.trim();
        if (flags.always && flags.deny) throw new Error('--always and --deny cannot go together.');
        if (note && !flags.deny)
          throw new Error('--note goes with --deny: say why you are denying.');
        return await resumeFlow(id, async (rt) => {
          const p = (await rt.state(id)).pendingApproval;
          if (!p) throw new Error(`Task ${id} has no approval waiting.`);
          if (flags.always) {
            // Saved before approving, so a refusal leaves the approval waiting.
            const tool = (await rt.state(id)).calls[p.callId]?.tool ?? '';
            standing().add(tool, p.risk);
            out(st.dim(`Always allowing ${tool}. Undo: remy approvals remove ${tool}`));
          }
          await rt.approve(
            id,
            p.callId,
            p.argsHash,
            !flags.deny,
            'user',
            note,
            flags.always === true,
          );
          out(
            st.dim(
              `${flags.deny ? 'Denied' : 'Approved'}: ${p.preview}${note ? ` (${note})` : ''}`,
            ),
          );
        });
      }

      case 'approvals': {
        const sub = rest[0] ?? 'list';
        if (sub === 'remove') {
          need(2, 'remy approvals remove <tool>');
          const tool = rest[1] as string;
          if (!standing().remove(tool)) throw new Error(`${tool} is not on the list.`);
          out(`${tool} asks again from now on.`);
          return 0;
        }
        if (sub !== 'list')
          throw new Error('Use remy approvals list or remy approvals remove <tool>.');
        const { tools } = makeRuntime(cfg(), { model: false });
        out(plainApprovals(standing().load(), (t) => tools.get(t)?.risk));
        return 0;
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
    await mcp?.close();
    ownStore?.close();
  }
}

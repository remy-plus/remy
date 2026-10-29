import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Browser, createBrowserTools, createLocalBrowser, profileInUse } from '@remy/browser';
import {
  type ApprovalRequest,
  BROWSER_HINT,
  type ConversationTurn,
  canStandingAllow,
  createRuntime,
  DEFAULT_BUDGET,
  type EventStore,
  fold,
  LONG_BUDGET,
  type ModelClient,
  NO_SEARCH_HINT,
  RISKS,
  type Risk,
  type RunOutcome,
  SYSTEM_PROMPT,
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
  calculate,
  createMemoryTools,
  createRecallTool,
  createRedactor,
  createScopedFetch,
  createScopedFs,
  createWebSearch,
  deleteFile,
  type Episode,
  editFile,
  fetchUrl,
  finish,
  listFiles,
  makeDir,
  moveFile,
  readFile,
  runCommand,
  updatePlan,
  writeFile,
} from '@remy/tools';
import { type ApprovalsStore, openApprovals, plainApprovals } from './approvals.ts';
import {
  bgState,
  currentEntry,
  type EntryPoint,
  forwardedFlags,
  nextCommand,
  pidAlive,
  readMarker,
  type Spawner,
  spawnWorker,
  startedLine,
  writeMarker,
} from './background.ts';
import {
  type ConnectApi,
  createChat,
  type ModelChoice,
  type RuntimeHooks,
  releaseLease,
} from './chat.ts';
import { type FileConfig, loadConfig } from './config.ts';
import { connectCommand } from './connect.ts';
import { applyPlan, planCustom, planFromEntry, suggestName, takenNames } from './connect-plan.ts';
import type { ConnectFlowApi } from './connect-ui.ts';
import type { ConnectionsApi } from './connections-view.ts';
import { openConversation, savedTurns, summarizeTurns, turnOf } from './conversation.ts';
import { pickSearch } from './search.ts';

/** Past tasks `recall` searches. */
const MAX_EPISODES = 300;

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
import { CATALOG, findCatalog } from './mcp-catalog.ts';
import { type McpHost, startMcp } from './mcp-host.ts';
import { importSources } from './mcp-import.ts';
import { openSecretStore, type SecretStore } from './mcp-secrets.ts';
import { type MemoryStore, openMemory, personaliseOn, plainMemory } from './memory.ts';
import { notificationFor, notify, type RunScript } from './notify.ts';
import { createOnboarding, type Onboarding } from './onboarding-flow.ts';
import { continueCommand, defaultMore, moreFor, pauseQuestion } from './pause.ts';
import { loadPrefs, savePrefs, type ThemeChoice } from './prefs.ts';
import { createProfileStore, profileContext } from './profile.ts';
import { withRecall } from './recall.ts';
import { type BackgroundTask, situationBlock } from './situation.ts';
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
  /** Opens a sign-in page in the browser; false when it could not (tests replace it). */
  openUrl?: (url: string) => Promise<boolean>;
  /** Replaces the MCP transports (tests). */
  mcpOptions?: (name: string) => McpConnectionOptions;
  /** How long startup waits for MCP servers (tests). */
  mcpBudgetMs?: number;
  /** Registers an interrupt (Ctrl-C) handler; returns a disposer. */
  onInterrupt?: (handler: () => Promise<void>) => () => void;
  /** Starts the background worker process (tests replace it). */
  spawner?: Spawner;
  /** The script and node flags a worker is started with. Default: this process. */
  entry?: EntryPoint;
  /** Runs an AppleScript for a notification (tests replace it). */
  notifyRun?: RunScript;
  /** Overrides process.platform for notifications (tests). */
  platform?: string;
  /** Waits between polls in `remy attach` (tests). Default 700 ms. */
  sleep?: (ms: number) => Promise<void>;
}

const STATUSES: TaskStatus[] = [
  'running',
  'waiting_approval',
  'waiting_user',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
];

const help = () => `remy: tell it what you need done.

Usage
  remy                            Open the chat (in a terminal)
  remy run "<prompt>" [options]   Start a task and run it
  remy run --background "<prompt>"
                                  Start a task and leave it running; Remy tells you
                                  when it finishes or needs you (REMY_NOTIFY=off to mute)
  remy attach <id>                Follow a background task live; answers its questions
  remy resume <id>                Continue a task that stopped
  remy continue <id> [--steps n] [--cost usd]
                                  Give a paused task more budget and carry on
                                  (default: the original budget again)
  remy approve <id> [--always | --deny [--note "<why>"]]
                                  Answer a pending approval, then continue; a note
                                  goes to the model with the denial; --always also
                                  allows that tool for good (writes and sends only)
  remy approvals [list|remove <tool>]
                                  See the tools you always allow, or stop allowing one
  remy memory [list|forget <id>|clear]
                                  See what Remy remembers about you, forget one note
                                  or all of them (notes are used only while
                                  "Personalise replies" is on in /profile)
  remy answer <id> "<text>"       Answer a pending question, then continue
  remy cancel <id>                Stop a task for good
  remy list [--status <status>]   List tasks
  remy show <id> [--json]         Show what a task did (--json prints raw events)
  remy login [<provider> --key-stdin [--model <id>] [--base-url <url>]]
                                  Connect a provider: pick one, paste the key, done
  remy login --list               Show saved logins (never the keys)
  remy logout <provider>          Forget a saved login
  remy connect [add|auth|list|remove]
                                  Connect apps and services through MCP servers; --import
                                  brings in the ones Claude Desktop or Claude Code already use
  remy browser [show|reset|install]
                                  Remy's own browser, which it uses to search and browse:
                                  show opens it so you can sign in to sites, reset signs
                                  out of everything, install gets Chromium for machines
                                  without Chrome or Edge
  remy --version | help

Options for run
  --profile <name>      ${Object.keys(PROFILES).join(', ')}
  --model <id>          Model id
  --base-url <url>      Any OpenAI-compatible endpoint
  --auto <risks>        Risks approved without asking (default read). Example: read,write
  --workspace <dir>     Folder the task may read and write (default ~/.remy/workspaces/<id>)
  --max-steps <n>       Step budget (default ${DEFAULT_BUDGET.maxSteps})
  --max-cost <usd>      Cost budget (default ${DEFAULT_BUDGET.maxCostUsd})
  --background          Start the task and return at once; follow it with remy attach
  --long                A bigger budget for long jobs: ${LONG_BUDGET.maxSteps} steps, $${LONG_BUDGET.maxCostUsd}, 4 hours
  --net-allow <hosts>   Only allow these domains. Example: example.com,docs.example.com

Options for every command
  --debug               Log model requests, model responses and events as JSON lines.
                        They go to stderr, or in the chat to REMY_HOME/debug-<time>.jsonl.
                        REMY_DEBUG=1 does the same; REMY_DEBUG=<path> picks the file.
  --reduced-motion      No animation in the chat (also REMY_REDUCED_MOTION=1)
  --minimal             A quiet scrolling chat instead of the full screen (also REMY_SCREEN=minimal;
                        /minimal in the chat saves the choice)
  --new                 Start a fresh conversation instead of picking up the last one

Options for connect
  --url <url>  --header K=V  --env K=V  --secret KEY  --secret-stdin  --yes  --import
  --oauth  --no-browser  --force
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
  Data lives in REMY_HOME (default ~/.remy). Remy searches and browses in a hidden browser on
  this machine (Chrome, Edge or Chromium) with its own profile in REMY_HOME/browser; it shows the
  window when you need to sign in. REMY_BROWSER=off turns it off; REMY_BROWSER_LOCAL=on lets it
  open local addresses.
  Search: REMY_SEARCH (or "search" in remy.config.json) picks browser, context, brave, tavily,
  searxng or off. Unset, a service whose key is set searches (CONTEXT_DEV_API_KEY, BRAVE_API_KEY,
  TAVILY_API_KEY, SEARXNG_URL), else the browser.
`;

const OPTIONS = {
  profile: { type: 'string' },
  model: { type: 'string' },
  'base-url': { type: 'string' },
  auto: { type: 'string' },
  workspace: { type: 'string' },
  'max-steps': { type: 'string' },
  'max-cost': { type: 'string' },
  steps: { type: 'string' },
  cost: { type: 'string' },
  long: { type: 'boolean' },
  background: { type: 'boolean' },
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
  oauth: { type: 'boolean' },
  'no-browser': { type: 'boolean' },
  force: { type: 'boolean' },
  status: { type: 'string' },
  json: { type: 'boolean' },
  debug: { type: 'boolean' },
  'reduced-motion': { type: 'boolean' },
  minimal: { type: 'boolean' },
  new: { type: 'boolean' },
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
  'CONTEXT_DEV_API_KEY',
];
const TOOL_SECRETS = ['BRAVE_API_KEY', 'TAVILY_API_KEY', 'CONTEXT_DEV_API_KEY', 'SEARXNG_URL'];

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
      'continue',
      'approve',
      'answer',
      'cancel',
      'list',
      'show',
      'attach',
      'worker',
      'login',
      'logout',
      'connect',
      'approvals',
      'memory',
      'browser',
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
  let memoryStore: MemoryStore | undefined;
  const memory = () => {
    memoryStore ??= openMemory(home, { enabled: () => personaliseOn(home) });
    return memoryStore;
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
      userHome: homeDir,
      ...(deps.openUrl && { openUrl: deps.openUrl }),
      ...(deps.fetch && { fetch: deps.fetch }),
    });
  }
  if (!deps.store) mkdirSync(home, { recursive: true });
  const ownStore = deps.store ? undefined : new SqliteEventStore(join(home, 'remy.sqlite'));
  const store: EventStore = deps.store ?? (ownStore as SqliteEventStore);
  let active: string | undefined;
  /** Connected MCP servers; started by the first runtime that needs a model. */
  let mcp: McpHost | undefined;
  /** The browser on this machine, one per process; it starts on the first page it opens. */
  let browser: Browser | undefined;
  let attaching: string | undefined;
  const dispose = deps.onInterrupt?.(async () => {
    await mcp?.close();
    await browser?.close();
    if (attaching) {
      out(`\nDetached. ${attaching} keeps running. Follow it again: remy attach ${attaching}`);
      return;
    }
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
        ...(deps.openUrl && { openUrl: deps.openUrl }),
        ...(deps.fetch && { fetch: deps.fetch }),
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

  /** Finished tasks never change, so each one is read and folded once per process. */
  const episodeCache = new Map<string, Episode | null>();
  /** The user's succeeded tasks, newest first (at most `MAX_EPISODES`), for `recall`. */
  async function pastTasks(exclude: string): Promise<Episode[]> {
    const done = (await store.listTasks({ status: 'succeeded' }))
      .filter((t) => t.taskId !== exclude)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_EPISODES);
    const out: Episode[] = [];
    for (const t of done) {
      let ep = episodeCache.get(t.taskId);
      if (ep === undefined) {
        const events = await store.read(t.taskId);
        const turn = turnOf(events);
        ep = turn
          ? {
              taskId: t.taskId,
              date: t.createdAt,
              prompt: turn.prompt,
              answer: turn.answer,
              tainted: fold(events).tainted,
            }
          : null;
        episodeCache.set(t.taskId, ep);
      }
      if (ep) out.push(ep);
    }
    return out;
  }

  /** Tasks a background worker started, newest first, with what `remy list` would call them. */
  async function backgroundTasks(): Promise<BackgroundTask[]> {
    const out: BackgroundTask[] = [];
    for (const t of await store.listTasks()) {
      const m = readMarker(home, t.taskId);
      if (m)
        out.push({ id: t.taskId, state: bgState(t.status, pidAlive(m.pid)), prompt: t.prompt });
    }
    return out;
  }

  const browserOn = () => env.REMY_BROWSER !== 'off';
  const browserDir = () => join(home, 'browser');
  function browserFor(file: FileConfig): Browser {
    const allow = list(flags['net-allow']) ?? file.netAllow;
    browser ??= createLocalBrowser({
      profileDir: browserDir(),
      allowLocal: env.REMY_BROWSER_LOCAL === 'on',
      ...(allow && { allow }),
    });
    return browser;
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
    const inner = debug ? debugModel(base, debug) : base;
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
    // Notes about the user: tools and recall exist only while personalising is on.
    if (personaliseOn(home)) {
      for (const t of createMemoryTools(memory())) tools.add(t);
      tools.add(createRecallTool(memory(), pastTasks));
    }
    const model = withRecall(inner, {
      enabled: () => personaliseOn(home),
      notes: () => memory().list(),
      hasTools: Boolean(tools.get('remember')),
      situation: async () =>
        situationBlock({
          now: new Date(),
          background: await backgroundTasks(),
          connections: mcp?.list() ?? [],
        }),
    });
    const search = pickSearch(env, env.REMY_SEARCH ?? file.search);
    if (search.provider) tools.add(createWebSearch(search.provider));
    // The browser on this machine; it searches too when the pick is the browser.
    if (browserOn())
      for (const t of createBrowserTools(browserFor(file)))
        if ((t.name !== 'web_search' || search.choice === 'browser') && !tools.get(t.name))
          tools.add(t);
    // Commands that never call a model (cancel) do not start the servers.
    if (opts.model) mcpHost(file, Boolean(opts.hooks))?.attach(tools);
    const timeline = createTimeline(st, { live: true });
    let pre = opts.taskId;
    const runtime = createRuntime({
      store,
      model,
      ...((browserOn() || !tools.get('web_search')) && {
        systemPrompt: [
          SYSTEM_PROMPT,
          ...(browserOn() ? [BROWSER_HINT] : []),
          ...(tools.get('web_search') ? [] : [NO_SEARCH_HINT]),
        ].join('\n\n'),
      }),
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

  const followUp = async (
    id: string,
    o: Extract<RunOutcome, { status: `waiting_${string}` | 'paused' }>,
  ) => {
    if (o.status === 'paused') {
      const s = await makeRuntime(cfg(), { model: false }).runtime.state(id);
      out(st.bold(pauseQuestion(o, defaultMore(s)).replace(/ Continue.*$/, '')));
      out(`Continue: ${st.accent(continueCommand(id))}`);
      out(st.dim(`More or less: remy continue ${id} --steps <n> --cost <usd>`));
    } else if (o.status === 'waiting_approval') {
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
    o: Exclude<RunOutcome, { status: `waiting_${string}` | 'paused' }>,
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
      if (o.status === 'paused') {
        const s = await rt.state(id);
        if (!deps.isTTY || !deps.ask) {
          await followUp(id, o);
          return 0;
        }
        out();
        const a = await deps.ask(`${pauseQuestion(o, defaultMore(s))} [y/N] `);
        if (a === null || !/^y(es)?$/i.test(a.trim())) {
          await followUp(id, o);
          return 0;
        }
        await rt.extend(id, moreFor(s, {}), 'user');
        continue;
      }
      if (o.status === 'waiting_approval' || o.status === 'waiting_user') {
        if (!deps.isTTY || !deps.ask) {
          await followUp(id, o);
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
            await followUp(id, o);
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
            await followUp(id, o);
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

  /** Spawns the worker for a task that already has its `task.created` event. */
  function startBackground(id: string): void {
    const { pid } = spawnWorker({
      home,
      id,
      cwd,
      env,
      entry: deps.entry ?? currentEntry(),
      extraArgs: forwardedFlags(flags),
      ...(deps.spawner && { spawner: deps.spawner }),
    });
    debug?.write('background', { id, pid });
    out(startedLine(id));
  }

  /** `remy worker <id>`: drives the task until it ends or needs the user, then says so. */
  async function workerFlow(id: string): Promise<number> {
    await exists(id);
    writeMarker(home, id, { pid: process.pid, startedAt: new Date().toISOString() });
    out(`worker ${process.pid} started for ${id}`);
    let code = 1;
    try {
      code = await resumeFlow(id);
    } catch (e) {
      out(`worker error: ${e instanceof Error ? e.message : String(e)}`);
    }
    const s = fold(await store.read(id));
    out(`worker finished: ${s.status}`);
    const note = notificationFor({ status: s.status, id, prompt: s.prompt });
    if (note)
      notify(note, {
        env,
        ...(deps.platform && { platform: deps.platform }),
        ...(deps.notifyRun && { run: deps.notifyRun }),
      });
    return code;
  }

  /**
   * `remy attach <id>`: prints the task's timeline and then follows the log. When the task needs
   * the user (approval, question, budget) the worker has already exited, so attach carries on in
   * this terminal: it asks inline and drives the task itself. Ctrl+C only detaches.
   */
  async function attachFlow(id: string): Promise<number> {
    const events = await exists(id);
    const tl = createTimeline(st, { live: false });
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const shown = events.length;
    const first = fold(events);
    out(`${st.bold(`Task ${id}`)}  ${first.status}`);
    out(st.dim(`Prompt: ${truncate(first.prompt, 200)}`));
    const lines: string[] = [];
    for (const e of events) {
      const line = tl.line(e);
      if (line) lines.push(line);
    }
    // Catching up: the last few lines are enough.
    if (lines.length > 12) out(st.dim(`… ${lines.length - 12} earlier lines: remy show ${id}`));
    for (const l of lines.slice(-12)) out(l);
    attaching = id;
    let seen = shown;
    let idle = 0;
    for (;;) {
      const now = await store.read(id);
      for (const e of now.slice(seen)) {
        const line = tl.line(e);
        if (line) out(line);
      }
      seen = now.length;
      const s = fold(now);
      if (s.final) {
        attaching = undefined;
        if (s.final.answer) out(`\n${s.final.answer.trim()}`);
        else if (s.final.reason) out(`\n${s.final.reason}`);
        out(st.dim(`${id}, ${s.step} steps, ${fmtCost(s.costUsd)}. Details: remy show ${id}`));
        return s.status === 'failed' ? 1 : 0;
      }
      if (s.status !== 'running') {
        attaching = undefined;
        if (deps.isTTY && deps.ask) return await resumeFlow(id);
        out(`Waiting for you (${s.status}). Run: ${nextCommand(s.status, id)}`);
        return 0;
      }
      const m = readMarker(home, id);
      idle = m && pidAlive(m.pid) ? 0 : idle + 1;
      if (idle >= 3) {
        // No live worker: confirm no one else holds the lease before saying so.
        const lease = await store.acquireLease(id, owner, 1000);
        if (lease) {
          await store.releaseLease(lease);
          attaching = undefined;
          out(`No worker is running ${id}. Pick it up: remy resume ${id}`);
          return 1;
        }
        idle = 0;
      }
      await sleep(700);
    }
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
    const long = flags.long ? LONG_BUDGET : undefined;
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
        ...(long && { ...long }),
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
    // The saved conversation keeps its workspace across launches; --new starts a fresh one.
    const conversation = openConversation(home);
    const saved = flags.new ? undefined : conversation.load();
    const workspace = flags.workspace
      ? resolve(cwd, flags.workspace)
      : saved && existsSync(saved.workspace)
        ? saved.workspace
        : join(home, 'workspaces', `chat_${randomUUID().replaceAll('-', '').slice(0, 12)}`);
    const resumed =
      saved && saved.workspace === workspace
        ? await savedTurns(saved, (id) => store.read(id))
        : undefined;
    if (!resumed) conversation.reset(workspace);
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
    const connectFlow: ConnectFlowApi = {
      choices: () =>
        CATALOG.map((e) => ({
          id: e.id,
          label: e.label,
          blurb: e.blurb,
          ...(e.folder && { folderLabel: e.folder.label }),
        })),
      prepare(a) {
        const taken = takenNames(home, file.mcpServers);
        if ('custom' in a) return planCustom(a.custom.input, a.custom.name, taken);
        const entry = findCatalog(a.entryId);
        if (!entry) throw new Error('That is not on the list.');
        return planFromEntry(entry, {
          taken,
          cwd: workspace,
          userHome: deps.homeDir ?? homedir(),
          ...(a.folder && { folder: a.folder }),
        });
      },
      suggestName: (input) => suggestName(input, takenNames(home, file.mcpServers)),
      defaultFolder: () => workspace,
      async add(plan, values, hooks) {
        const stored = applyPlan(plan, { home, secrets: secretsFor(), values });
        for (const s of plan.secrets) {
          const v = values[s.key];
          if (v) addSecret(`mcp:${plan.name}.${s.key}`, v);
        }
        const saved = `Added ${plan.name}${stored.length ? `. Saved ${stored.join(', ')}` : ''}.`;
        if (!mcp) return `${saved} Remy connects to it the next time it starts.`;
        const line = plan.oauth ? await mcp.signIn?.(plan.name, hooks) : await mcp.start(plan.name);
        return `${saved} ${line ?? ''}`.trim();
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
      memory: { store: memory(), personalise: () => personaliseOn(home) },
      startTour: () => onboarding?.start(),
      ...(browserOn() && {
        browser: {
          visible: () => browser?.visible ?? false,
          show: () => browserFor(file).show(),
          hide: () => browserFor(file).hide(),
          page: () => browser?.current()?.url,
        },
      }),
      conversation: {
        turns: resumed ?? [],
        onTurn: (id) => conversation.add(id),
        onNew: () => conversation.reset(workspace),
        onSummary: (text, upTo) => conversation.summarise(text, upTo),
      },
      summarize: (previous, turns) => summarizeTurns(model, previous, turns),
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
      background: {
        async start(prompt) {
          // Its own runtime and workspace: the chat's conversation is not part of this task.
          const id = `task_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
          const { runtime } = makeRuntime(file, { model, taskId: id, hooks: {} });
          const config = taskConfig(file, model.id, join(home, 'workspaces', id));
          mkdirSync(config.workspaceDir, { recursive: true });
          await mcp?.ready;
          await runtime.start(prompt, config);
          const { pid } = spawnWorker({
            home,
            id,
            cwd,
            env,
            entry: deps.entry ?? currentEntry(),
            extraArgs: forwardedFlags(flags),
            ...(deps.spawner && { spawner: deps.spawner }),
          });
          debug?.write('background', { id, pid });
          return id;
        },
        isRunning(id) {
          const m = readMarker(home, id);
          return Boolean(m && pidAlive(m.pid));
        },
      },
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
        signIn: (name, hooks) => mcp?.signIn?.(name, hooks) ?? Promise.resolve(''),
      } satisfies ConnectionsApi,
      addConnection: connectFlow,
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
      memory: memory(),
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
        if (flags.background) {
          startBackground(id);
          return 0;
        }
        out(st.dim(`Task ${id}. Workspace ${config.workspaceDir}`));
        return await drive(runtime, id);
      }

      case 'worker': {
        need(1, 'remy worker <id>');
        return await workerFlow(rest[0] as string);
      }

      case 'attach': {
        need(1, 'remy attach <id>');
        return await attachFlow(rest[0] as string);
      }

      case 'resume':
        need(1, 'remy resume <id>');
        return await resumeFlow(rest[0] as string);

      case 'continue': {
        need(1, 'remy continue <id> [--steps n] [--cost usd]');
        const id = rest[0] as string;
        const num = (v: string | undefined, name: string) => {
          if (v === undefined) return undefined;
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
          return n;
        };
        const steps = num(flags.steps, '--steps');
        const costUsd = num(flags.cost, '--cost');
        return await resumeFlow(id, async (rt) => {
          const s = await rt.state(id);
          if (s.status !== 'paused') throw new Error(`Task ${id} is not paused (${s.status}).`);
          const more = moreFor(s, {
            ...(steps !== undefined && { steps }),
            ...(costUsd !== undefined && { costUsd }),
          });
          await rt.extend(id, more, 'user');
          const bits = [
            more.steps && `${more.steps} more steps`,
            more.costUsd && `$${more.costUsd.toFixed(2)} more`,
          ].filter(Boolean);
          out(st.dim(`Continuing ${id} with ${bits.join(' and ') || 'more time'}.`));
        });
      }

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

      case 'memory': {
        const sub = rest[0] ?? 'list';
        if (sub === 'forget') {
          need(2, 'remy memory forget <id>');
          const id = rest[1] as string;
          if (!memory().remove(id)) throw new Error(`There is no saved note ${id}.`);
          out(`Forgot ${id}.`);
          return 0;
        }
        if (sub === 'clear') {
          const n = memory().clear();
          out(n ? `Forgot ${n} note${n === 1 ? '' : 's'}.` : 'There was nothing to forget.');
          return 0;
        }
        if (sub !== 'list') throw new Error('Use remy memory list, forget <id> or clear.');
        out(plainMemory(memory().load(), personaliseOn(home)));
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
        const label = (t: (typeof tasks)[number]) => {
          const m = readMarker(home, t.taskId);
          return m ? `bg ${bgState(t.status, pidAlive(m.pid))}` : t.status;
        };
        const w = Math.max(...tasks.map((t) => label(t).length));
        for (const t of tasks)
          out(
            `${t.taskId}  ${label(t).padEnd(w)}  ${st.dim(t.createdAt.slice(0, 16).replace('T', ' '))}  ${truncate(t.prompt, 60)}`,
          );
        return 0;
      }

      case 'browser': {
        const sub = rest[0] ?? 'show';
        if (sub === 'install') {
          // For machines without Chrome or Edge (a server): Playwright's own Chromium.
          const pkg = createRequire(import.meta.url).resolve('playwright-core/package.json');
          const r = spawnSync(
            process.execPath,
            [join(dirname(pkg), 'cli.js'), 'install', 'chromium'],
            {
              stdio: 'inherit',
            },
          );
          if (r.status !== 0) throw new Error('Chromium did not install. See the output above.');
          out('Chromium is installed. Remy uses it when Chrome and Edge are not there.');
          return 0;
        }
        if (sub === 'reset') {
          if (profileInUse(browserDir()))
            throw new Error("Remy's browser is open in another Remy. Close that one first.");
          rmSync(browserDir(), { recursive: true, force: true });
          out("Remy's browser is cleared: every site is signed out.");
          return 0;
        }
        if (sub !== 'show')
          throw new Error('Use remy browser show, remy browser reset or remy browser install.');
        const b = browserFor(cfg());
        await b.show();
        out(
          "Remy's browser is open, on its own profile. Sign in to the sites you want Remy to use, then close the window.",
        );
        while (b.visible) await new Promise((r) => setTimeout(r, 500));
        out('Closed. Remy keeps those sign-ins.');
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
    await browser?.close();
    ownStore?.close();
  }
}

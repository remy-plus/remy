import { execFile, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Browser,
  browserSearch,
  createBrowserTools,
  createLightpandaProvider,
  createLocalBrowser,
  profileInUse,
  remoteNotice,
  resolveEngine,
} from '@remy/browser';
import {
  type ApprovalRequest,
  BROWSER_HINT,
  type ConversationTurn,
  canStandingAllow,
  createRuntime,
  DEFAULT_BUDGET,
  type EventStore,
  fold,
  helperIds,
  isHelperTask,
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
import {
  BUILTIN_CATALOG,
  DEFAULT_CAPS,
  modelFromEnv,
  PROFILE_KEY_ENVS,
  PROFILES,
  resolveCaps,
} from '@remy/models';
import { SqliteEventStore } from '@remy/store';
import {
  askUser,
  calculate,
  computerFromConfig,
  createComputerTools,
  createDelegate,
  createFetchUrl,
  createHowtoTool,
  createMemoryTools,
  createRecallTool,
  createRedactor,
  createScheduleTools,
  createScopedFetch,
  createScopedFs,
  createSkillTools,
  createWebSearch,
  deleteFile,
  type Episode,
  editFile,
  finish,
  HOWTO_HINT,
  listFiles,
  makeDir,
  moveFile,
  readFile,
  runCommand,
  SAVE_SKILL_HINT,
  type SearchProvider,
  SKILLS_HINT,
  skillsBlock,
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
import { makeKeyReader, remoteBrowserStatus, resolveRemoteBrowser } from './browser-remote.ts';
import {
  type ConnectApi,
  createChat,
  type ModelChoice,
  type RuntimeHooks,
  releaseLease,
} from './chat.ts';
import { computerCommand } from './computer-command.ts';
import { type FileConfig, loadConfig } from './config.ts';
import { connectCommand } from './connect.ts';
import {
  applyPlan,
  planCustom,
  planFromEntry,
  planFromRegistry,
  suggestName,
  takenNames,
} from './connect-plan.ts';
import type { ConnectFlowApi } from './connect-ui.ts';
import type { ConnectionsApi } from './connections-view.ts';
import { openConversation, savedTurns, summarizeTurns, turnOf } from './conversation.ts';
import { type ReaderSetup, resolveReader } from './readers.ts';
import {
  gatherSearchPlan,
  type KeyRoute,
  type KeySource,
  makeService,
  resolveSearchKeys,
  routedSearch,
  SERVICES,
} from './search.ts';
import { searchCommand, TEST_QUERY } from './search-command.ts';
import { createSearchMount, type SearchStatusView } from './serve-search.ts';
import { installerFor } from './service.ts';

/** Past tasks `recall` searches. */
const MAX_EPISODES = 300;

import { capabilitiesBlock, onceCapabilities } from './capabilities.ts';
import { type Credentials, keychainOff, openCredentials } from './credentials.ts';
import { TICK_MS, tick } from './daemon.ts';
import { debugModel, openDebug } from './debug.ts';
import { demoModel } from './demo.ts';
import { type Facts, gatherFacts, plainChecks, runChecks } from './doctor.ts';
import {
  createNoteEmbedder,
  type EmbedEndpoint,
  embeddingModel,
  embeddingStatusFile,
  readEmbeddingStatus,
} from './embeddings.ts';
import { createTimeline, fmtCost, styler, totalsLine, truncate } from './format.ts';
import { loadHelperRoles } from './helper-roles.ts';
import { improve } from './improve.ts';
import {
  defaultModelFor,
  listLogins,
  providerChoices,
  SUGGESTED_MODELS,
  saveLogin,
} from './login.ts';
import { forBudget, forNotice, parseDuration } from './long-run.ts';
import { CATALOG, findCatalog } from './mcp-catalog.ts';
import { type McpHost, startMcp } from './mcp-host.ts';
import { importSources } from './mcp-import.ts';
import { type RegistryApp, searchRegistry } from './mcp-registry.ts';
import { openSecretStore, type SecretStore } from './mcp-secrets.ts';
import { type MemoryStore, openMemory, personaliseOn, plainMemory } from './memory.ts';
import { cardNotification, notificationFor, notify, type RunScript } from './notify.ts';
import { createOnboarding, type Onboarding } from './onboarding-flow.ts';
import { continueCommand, defaultMore, moreFor, pauseQuestion } from './pause.ts';
import { loadPrefs, savePrefs, type ThemeChoice } from './prefs.ts';
import { createProfileStore, profileContext } from './profile.ts';
import { reachLines, recommendReach } from './reach.ts';
import { readReachFacts } from './reach-facts.ts';
import { withRecall } from './recall.ts';
import { collectReview, formatReview, parseSince } from './review.ts';
import { plainSchedules } from './schedule.ts';
import { openSchedules } from './schedule-store.ts';
import {
  type Run,
  startVm,
  stopVm,
  VM_PORT,
  VM_TIMEOUT_MS,
  type VmConnection,
  vmSearch,
  vmServerScript,
  vmStatus,
  waitForVm,
} from './search-vm.ts';
import { listenServe } from './serve.ts';
import { actionRoutes } from './serve-actions.ts';
import { resolveServeBind } from './serve-bind.ts';
import { createBrainMount } from './serve-brain.ts';
import { createBrowserMount } from './serve-browser.ts';
import { chatRoutes } from './serve-chats.ts';
import { createConnectMount, writeComputers } from './serve-connect.ts';
import { homeRoutes } from './serve-home.ts';
import { reviewRoutes } from './serve-review.ts';
import { createSchedulesMount } from './serve-schedules.ts';
import {
  assertUnderMonthlyCap,
  capToMonthRemaining,
  chooseWorkspace,
  configWithPrefs,
  createSpend,
  monthRemaining,
  openWebPrefs,
  settingsRoutes,
} from './serve-settings.ts';
import { createSkillsMount } from './serve-skills.ts';
import { announceFirstRunToken, makeServeToken, serveTokenHash } from './serve-token.ts';
import {
  type AsyncExec,
  createFishKeySource,
  createVoiceMount,
  openVoiceLedger,
  readFishKeyAsync,
} from './serve-voice.ts';
import { type BackgroundTask, situationBlock } from './situation.ts';
import { openSkills, plainSkill, plainSkills, type SkillStore } from './skills.ts';
import {
  addCommand,
  parseDirectoryRef,
  prepareFromDirectory,
  searchBots,
  searchSkillsSh,
} from './skills-directory.ts';
import { fetchSkill } from './skills-web.ts';
import { stdoutGate } from './stream.ts';
import { createTheme, detectColor } from './theme.ts';
import { isTrustLevel, type TrustLevel, trustChanged, trustSummary } from './trust.ts';
import { DEFAULT_PORT as DEFAULT_WEBHOOK_PORT } from './webhook-bind.ts';
import { BODY_MAX_BYTES, webhookConfig, webhookPrompt } from './webhook-payload.ts';
import { daemonWebhooks, processStarter, startWebhooks } from './webhook-service.ts';
import { openHooks } from './webhook-store.ts';
import { newToken, rotateToken, sha256Hex, sharedToken } from './webhook-token.ts';

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
  /** Runs the Keychain lookups for search, reader and cloud-browser keys (tests replace it). */
  keyExec?: AsyncExec;
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
  /** Resolves to stop `remy serve` (tests); without it, serve runs until the process ends. */
  serveStop?: Promise<void>;
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
  remy trust [ask|steady|away]   See or set how much Remy does without asking
  remy approvals [list|remove <tool>]
                                  See the tools you always allow, or stop allowing one
  remy memory [list|forget <id>|clear]
                                  See what Remy remembers about you, forget one note
                                  or all of them (notes are used only while
                                  "Personalise replies" is on in /profile)
  remy improve propose|check|apply|list
                                  Remy proposes edits to its own prompts from failed eval runs;
                                  nothing changes until you apply a checked proposal
  remy skills [list|show <name>|find <query> [--bots]|add <folder, link, skills.sh:owner/repo/skill or bot:slug>|update <name>|rm <name>]
                                  How-tos Remy follows for kinds of tasks; add shows the
                                  SKILL.md and asks first (--yes skips the question);
                                  find searches skills.sh, or botdirectory.ai with --bots
  remy answer <id> "<text>"       Answer a pending question, then continue
  remy cancel <id>                Stop a task for good
  remy list [--status <status>]   List tasks
  remy show <id> [--json]         Show what a task did (--json prints raw events)
  remy computer list|add|test|rm  Machines Remy may run commands on: add <name> --docker <image>
                                  (Remy keeps its own container), --container <name>, or
                                  --ssh user@host[:port] [--key <path>]; test runs uname -a there
  remy search [key <id> [--key-stdin]|test [<service>]]
                                  Which search route answers and why, and which services have a key
                                  (environment or Keychain); key saves one in the Keychain without
                                  showing it (a search service, or firecrawl, cloudflare,
                                  cloudflare-account, steel, browserbase, browserbase-project);
                                  test runs one real search on a service and times it
  remy login [<provider> --key-stdin [--model <id>] [--base-url <url>]]
                                  Connect a provider: pick one, paste the key, done
  remy login --list               Show saved logins (never the keys)
  remy logout <provider>          Forget a saved login
  remy connect [add|auth|list|remove]
                                  Connect apps and services through MCP servers; --import
                                  brings in the ones Claude Desktop or Claude Code already use
  remy schedule [list|add "<when>" "<prompt>"|run <id>|rm <id>|pause <id>|resume <id>]
                                  Run a task on a schedule, such as "every day at 9", or
                                  "when ~/Downloads changes". Each run asks before it acts
  remy daemon [install|uninstall|status]
                                  Runs schedules; install starts it when you log in (macOS)
  remy browser [show|reset|install|vm start|vm stop|vm status]
                                  Remy's own browser, which it uses to search and browse:
                                  show opens it so you can sign in to sites, reset signs
                                  out of everything, install gets Chromium for machines
                                  without Chrome or Edge
  remy webhook [list|add <name> "<prompt>"|rm <name>|token [<name>] [--rotate]|enable|disable|start|test <name> [--data <file>]]
                                  Start a saved task from an outside call. Off until enable;
                                  listens on 127.0.0.1 only; the payload is data, not orders
  remy serve [--port 7790] [--host 127.0.0.1]
                                  Serve Remy over HTTP for the web app: tasks, approvals and a
                                  live event stream. 127.0.0.1 only unless REMY_SERVE_ALLOW_REMOTE=on
  remy serve token [--rotate]     Make the access token (shown once; only its hash is kept)
  remy doctor                     See what is set up and the next step for each
  remy review [--since 24h|7d|<date>]
                                  What ran without you (schedules, watches, background), what it
                                  changed, and what waits for your OK. Reads the log only
  remy --version | help

Options for run
  --profile <name>      ${Object.keys(PROFILES).join(', ')}
  --model <id>          Model id
  --base-url <url>      Any OpenAI-compatible endpoint
  --auto <risks>        Risks approved without asking (default read). Example: read,write
  --workspace <dir>     Folder the task may read and write (default ~/.remy/workspaces/<id>; remy serve uses it for every task)
  --max-steps <n>       Step budget (default ${DEFAULT_BUDGET.maxSteps})
  --max-cost <usd>      Cost budget (default ${DEFAULT_BUDGET.maxCostUsd})
  --background          Start the task and return at once; follow it with remy attach
  --long                A bigger budget for long jobs: ${LONG_BUDGET.maxSteps} steps, $${LONG_BUDGET.maxCostUsd}, 4 hours
  --for <time>          Set steps, clock and cost for a long job together, e.g. --for 3h (up to 24h); prints the most it can spend first
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
  --search <words>  --registry <name>  --oauth  --no-browser  --force
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
  Skills: REMY_SKILL_STEPS=on sends the best match's steps with your message.

  Data lives in REMY_HOME (default ~/.remy). Remy searches and browses in a hidden browser on
  this machine (Chrome, Edge or Chromium) with its own profile in REMY_HOME/browser; it shows the
  window when you need to sign in. REMY_BROWSER=off turns it off; REMY_BROWSER_LOCAL=on lets it
  open local addresses.
  Search picks its own route: a service whose key is set (EXA_API_KEY, TINYFISH_API_KEY,
  PERPLEXITY_API_KEY, TAVILY_API_KEY, LINKUP_API_KEY, SERPER_API_KEY, BRAVE_API_KEY,
  CONTEXT_DEV_API_KEY, SEARXNG_URL, in that order; on a Mac a key may be in the Keychain instead,
  service remy, account exa, perplexity, ...: remy search key <service>), then the container
  (remy browser vm start, with Docker running), then the hidden browser. A route that stops working
  is skipped and the next answers; remy doctor shows the order and the step to improve it.
  REMY_SEARCH (or "search" in remy.config.json) forces one: browser, vm, exa, tinyfish,
  perplexity, tavily, linkup, serper, brave, context, searxng or off. A choice saved in the web
  app's Settings is used when none of these is set and its service has a key.
  Pages Remy cannot read directly can go to Firecrawl (FIRECRAWL_API_KEY) or Cloudflare Browser
  Rendering (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN); REMY_READER=firecrawl|cloudflare|
  always|off overrides. REMY_BROWSER=steel|browserbase uses a cloud browser (STEEL_API_KEY, or
  BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID); save any of these keys with remy search key <id>.
`;

const OPTIONS = {
  profile: { type: 'string' },
  model: { type: 'string' },
  'base-url': { type: 'string' },
  auto: { type: 'string' },
  workspace: { type: 'string' },
  'max-steps': { type: 'string' },
  'max-cost': { type: 'string' },
  from: { type: 'string' },
  'max-usd': { type: 'string' },
  suite: { type: 'string' },
  steps: { type: 'string' },
  cost: { type: 'string' },
  long: { type: 'boolean' },
  bots: { type: 'boolean' },
  for: { type: 'string' },
  background: { type: 'boolean' },
  bind: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  data: { type: 'string' },
  rotate: { type: 'boolean' },
  shared: { type: 'boolean' },
  since: { type: 'string' },
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
  search: { type: 'string' },
  registry: { type: 'string' },
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
  docker: { type: 'string' },
  container: { type: 'string' },
  ssh: { type: 'string' },
  key: { type: 'string' },
  network: { type: 'string' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
} as const;

const SECRET_ENV = [
  'REMY_API_KEY',
  ...PROFILE_KEY_ENVS,
  'BRAVE_API_KEY',
  'TAVILY_API_KEY',
  'TINYFISH_API_KEY',
  'CONTEXT_DEV_API_KEY',
  'EXA_API_KEY',
  'PERPLEXITY_API_KEY',
  'LINKUP_API_KEY',
  'SERPER_API_KEY',
];
const TOOL_SECRETS = [
  'BRAVE_API_KEY',
  'TAVILY_API_KEY',
  'TINYFISH_API_KEY',
  'CONTEXT_DEV_API_KEY',
  'EXA_API_KEY',
  'PERPLEXITY_API_KEY',
  'LINKUP_API_KEY',
  'SERPER_API_KEY',
  'SEARXNG_URL',
];

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
      'trust',
      'memory',
      'skills',
      'browser',
      'schedule',
      'daemon',
      'webhook',
      'serve',
      'doctor',
      'review',
      'improve',
      'search',
      'computer',
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
      openCredentials({ home, ...(keychainOff(env) && { platform: 'linux' as const }) });
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
  let embedder: ReturnType<typeof createNoteEmbedder> | undefined;
  /** Embeddings for recall: off unless REMY_EMBEDDINGS=on, and then only to the chat provider. */
  const noteEmbedder = () =>
    (embedder ??= createNoteEmbedder({
      on: env.REMY_EMBEDDINGS === 'on',
      personalising: () => personaliseOn(home),
      store: memory(),
      endpoint: () => embedEndpoint(cfg()),
      statusFile: embeddingStatusFile(home),
      ...(deps.fetch && { fetch: deps.fetch }),
    }));
  let skillStore: SkillStore | undefined;
  const skills = () => {
    skillStore ??= openSkills(home, deps.cwd);
    return skillStore;
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
        ...(keychainOff(env) && { platform: 'linux' as const }),
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
    if (env.REMY_DEMO === 'on') return demoModel();
    return modelFromEnv(providerEnv(file));
  }

  /** The chat provider as env settings: flags, then env, then a saved login, then remy.config.json. */
  function providerEnv(file: FileConfig): Record<string, string | undefined> {
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
    return e;
  }

  /** Where embeddings would go: the chat provider, never another. Undefined when it cannot be worked out. */
  function embedEndpoint(file: FileConfig): EmbedEndpoint | undefined {
    try {
      const e = providerEnv(file);
      const profile = e.REMY_PROFILE ? PROFILES[e.REMY_PROFILE] : undefined;
      const baseUrl = e.REMY_BASE_URL ?? profile?.baseUrl;
      const model = baseUrl ? embeddingModel(env, baseUrl) : undefined;
      if (!baseUrl || !model) return undefined;
      const key = e.REMY_API_KEY ?? (profile?.keyEnv ? e[profile.keyEnv] : undefined);
      return { baseUrl, ...(key && { apiKey: key }), model };
    } catch {
      return undefined;
    }
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
      .filter((t) => !isHelperTask(t.taskId))
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
  const vmFile = () => join(home, 'search-vm.json');
  const machineHasBrowser = () =>
    browserOn() &&
    (process.platform !== 'darwin' ||
      ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app'].some((p) =>
        existsSync(p),
      ));
  // Search keys: the environment, plus any found in the Keychain once `prepareSearch` has run. That
  // runs only when a search is first needed (the first web_search call, `remy search`, `remy
  // doctor`, the search status route), so commands that never search never touch the Keychain.
  const keyOpts = deps.keyExec ? { exec: deps.keyExec } : {};
  let searchEnv = env;
  let searchSources: Record<KeyRoute, KeySource> | undefined;
  let searchPrepared: Promise<void> | undefined;
  const prepareSearch = () =>
    (searchPrepared ??= resolveSearchKeys(env, keyOpts).then((r) => {
      searchEnv = r.env;
      searchSources = r.sources;
      searchPlanMemo = undefined;
      for (const k of r.found) addSecret(k.name, k.value);
    }));
  // Page readers (Firecrawl, Cloudflare) and cloud browser keys, found the same way.
  let readerSetup: ReaderSetup | undefined;
  let browserKeyLines: string[] = [];
  let readerPrepared: Promise<void> | undefined;
  const prepareReader = () =>
    (readerPrepared ??= Promise.all([
      resolveReader(env, keyOpts),
      remoteBrowserStatus(env, keyOpts),
    ]).then(([r, b]) => {
      readerSetup = r;
      browserKeyLines = b.lines;
      for (const k of [...r.found, ...b.found]) addSecret(k.name, k.value);
    }));
  /** The search service saved in the web app's Settings, if any (env and config beat it). */
  const preferredSearch = () => openWebPrefs(home).chosen().searchPrefer ?? undefined;
  let dockerUp: boolean | undefined;
  const hasDocker = () => (dockerUp ??= spawnSync('docker', ['info']).status === 0);
  const planFor = (file: FileConfig, keyEnv: Record<string, string | undefined>) =>
    gatherSearchPlan({
      env: keyEnv,
      override: env.REMY_SEARCH ?? file.search,
      prefer: preferredSearch(),
      vmSetUp: existsSync(vmFile()),
      browser: machineHasBrowser(),
      hasDocker,
    });
  let searchPlanMemo:
    | { prefer: string | undefined; plan: ReturnType<typeof gatherSearchPlan> }
    | undefined;
  /** The search route order, worked out once per process (again if the saved choice changes); Docker is asked only when no pick or key settles it. */
  const searchPlan = (file: FileConfig) => {
    const prefer = preferredSearch();
    if (!searchPlanMemo || searchPlanMemo.prefer !== prefer)
      searchPlanMemo = { prefer, plan: planFor(file, searchEnv) };
    return searchPlanMemo.plan;
  };
  const daemonInstaller = () =>
    installerFor(process.platform, {
      entry: deps.entry ?? currentEntry(),
      homeDir: homedir(),
      logFile: join(home, 'logs', 'daemon.log'),
      path: env.PATH,
      run: (cmd, args) => {
        const r = spawnSync(cmd, args, { encoding: 'utf8' });
        return { status: r.status, stdout: r.stdout ?? '' };
      },
      files: {
        write: (path, text) => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        },
        remove: (path) => rmSync(path, { force: true }),
      },
    });
  /** What this machine has set up; shared by `remy doctor` and the capabilities block. */
  const machineFacts = (lazySearch = false): Facts => {
    const file = cfg();
    return gatherFacts({
      node: process.version,
      platform: process.platform,
      model: credentials().defaultProvider() ?? env.REMY_PROFILE ?? file.profile,
      hasChromeApp: () =>
        ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app'].some((p) =>
          existsSync(p),
        ),
      daemonOn: () => daemonInstaller()?.isOn() ?? false,
      service: () => {
        const s = daemonInstaller();
        return s && { label: s.label, enableStep: s.enableStep, unavailable: s.unavailable() };
      },
      schedules: () => openSchedules(home).list().length,
      search: lazySearch ? { order: [], override: false, off: false } : searchPlan(file),
      remoteBrowser: () => {
        const c = resolveRemoteBrowser(env, makeKeyReader(env));
        return c.kind === 'remote'
          ? { ok: true, detail: remoteNotice(c.provider.label) }
          : c.kind === 'error'
            ? { ok: false, detail: c.message }
            : undefined;
      },
      helperProblems: () => loadHelperRoles(home, process.cwd()).problems,
      embeddings: () =>
        readEmbeddingStatus(home, env.REMY_EMBEDDINGS === 'on', personaliseOn(home)),
    });
  };
  const vmRun: Run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { ok: r.status === 0, out: r.stdout ?? '' };
  };
  /** Starts the container and saves how to reach it; the saved file also means "search there". */
  const startVmSearch = async (): Promise<void> => {
    const conn = { url: `http://127.0.0.1:${VM_PORT}`, token: randomBytes(24).toString('hex') };
    const started = startVm(vmRun, { port: VM_PORT, token: conn.token, script: vmServerScript() });
    if (started === 'no-docker')
      throw new Error('Search in a container needs Docker or Colima. Install one, then try again.');
    if (started === 'failed') throw new Error('The container did not start.');
    if (started === 'already-running') return;
    writeFileSync(vmFile(), JSON.stringify(conn), { mode: 0o600 });
    if (!(await waitForVm(conn)))
      throw new Error('The container started but did not answer. Try remy browser vm stop.');
  };
  const vmConnection = (): VmConnection => {
    try {
      return JSON.parse(readFileSync(vmFile(), 'utf8')) as VmConnection;
    } catch {
      return { url: `http://127.0.0.1:${VM_PORT}`, token: '' };
    }
  };
  function browserFor(file: FileConfig): Browser {
    const allow = list(flags['net-allow']) ?? file.netAllow;
    // REMY_BROWSER=steel|browserbase: a cloud browser. A missing key is an error, never a quiet
    // switch back to this computer.
    const choice = resolveRemoteBrowser(env, makeKeyReader(env));
    if (choice.kind === 'error') throw new Error(choice.message);
    if (choice.kind === 'remote')
      for (const v of choice.secrets) addSecret('REMOTE_BROWSER_KEY', v);
    // REMY_BROWSER_ENGINE=lightpanda: a small engine started on this computer. If the program is
    // missing, Remy says so (here and in the browser's status) and uses Chrome. Never silently.
    const engine = resolveEngine(env);
    if (engine.kind === 'error') throw new Error(engine.message);
    if (engine.kind !== 'chrome' && choice.kind === 'remote')
      throw new Error(
        'REMY_BROWSER (a cloud browser) and REMY_BROWSER_ENGINE are both set. Use one: unset either.',
      );
    if (!browser && engine.kind === 'missing')
      process.stderr.write(`${engine.message} Using Chrome for now.\n`);
    browser ??= createLocalBrowser({
      ...(choice.kind === 'remote' && { remote: choice.provider }),
      ...(engine.kind === 'lightpanda' && {
        remote: createLightpandaProvider({
          binary: engine.path,
          allowLocal: env.REMY_BROWSER_LOCAL === 'on',
        }),
      }),
      ...(engine.kind === 'missing' && {
        fallbackNotice: `${engine.message} Using Chrome for now.`,
      }),
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
      createFetchUrl({
        // Reader keys are looked up the first time a page needs a reader.
        reader: async () => {
          if (env.REMY_READER?.trim().toLowerCase() === 'off') return undefined;
          await prepareReader();
          return readerSetup?.reader;
        },
        mode: () => (env.REMY_READER?.trim().toLowerCase() === 'always' ? 'always' : 'auto'),
      }),
      askUser,
      finish,
    ]);
    // Notes about the user: tools and recall exist only while personalising is on.
    if (personaliseOn(home)) {
      for (const t of createMemoryTools(memory())) tools.add(t);
      tools.add(createRecallTool(memory(), pastTasks, noteEmbedder().source));
      // Corrections become how-tos: with personalising on only.
      const howto = createHowtoTool({ ...skills(), redact });
      if (howto) tools.add(howto);
    }
    for (const t of createSkillTools({
      ...skills(),
      connected: (name) => Boolean(mcp?.list().some((c) => c.name === name)),
    }))
      tools.add(t);
    // Machines the user set up in remy.config.json. A bad entry stops here with the reason.
    if (file.computers?.length)
      for (const t of createComputerTools(file.computers.map((c) => computerFromConfig(c))))
        tools.add(t);
    const helpersOn = env.REMY_HELPERS === 'on' || env.REMY_HELPERS === 'act';
    const helpersAct = env.REMY_HELPERS === 'act';
    const helperRoles = loadHelperRoles(home, process.cwd()).roles;
    if (helpersOn) tools.add(createDelegate(helperRoles, { act: helpersAct }));
    const schedules = openSchedules(home);
    for (const t of createScheduleTools({
      add: (when, prompt) => schedules.add(when, prompt, new Date()),
      list: () => schedules.list(),
    }))
      tools.add(t);
    // Probes can be slow, so the block is built once per process, at the first message.
    const capabilities = onceCapabilities(() =>
      capabilitiesBlock({
        // Before the first search the Keychain has not been read, so the block does not guess a route.
        facts: machineFacts(!searchPrepared),
        searchKnown: Boolean(searchPrepared),
        helpers: helpersOn,
        skills: skills().list().length,
        trust: loadPrefs(home).trust ?? 'ask',
      }),
    );
    const model = withRecall(inner, {
      enabled: () => personaliseOn(home),
      notes: () => memory().list(),
      semantic: noteEmbedder().source,
      hasTools: Boolean(tools.get('remember')),
      howto: () => personaliseOn(home) && Boolean(tools.get('save_howto')),
      skills: (query) =>
        skillsBlock(skills().list(), query, {
          steps: env.REMY_SKILL_STEPS === 'on',
          onSteps: (s) => skills().used(s.name),
        }),
      situation: async () =>
        situationBlock({
          now: new Date(),
          background: await backgroundTasks(),
          connections: mcp?.list() ?? [],
          capabilities: capabilities(),
        }),
    });
    // web_search exists unless search is switched off; its keys and route are worked out at the first call.
    const searchOverride = (env.REMY_SEARCH ?? file.search)?.trim().toLowerCase();
    if (searchOverride !== 'off') {
      let routed: { plan: ReturnType<typeof searchPlan>; provider: SearchProvider } | undefined;
      const provider: SearchProvider = {
        async search(query, count) {
          await prepareSearch();
          const plan = searchPlan(file);
          if (routed?.plan !== plan)
            routed = {
              plan,
              provider: routedSearch(plan, (route) =>
                route === 'browser'
                  ? browserSearch(browserFor(file))
                  : route === 'vm'
                    ? vmSearch(vmConnection, fetch, () =>
                        startVmSearch().then(
                          () => true,
                          () => false,
                        ),
                      )
                    : makeService(route, searchEnv),
              ).provider,
            };
          return routed.provider.search(query, count);
        },
      };
      tools.add(
        createWebSearch(provider, {
          timeoutMs: existsSync(vmFile()) ? VM_TIMEOUT_MS : 45_000,
        }),
      );
    }
    // The browser on this machine (it never answers web_search here: the route above does).
    if (browserOn())
      for (const t of createBrowserTools(browserFor(file)))
        if (t.name !== 'web_search' && !tools.get(t.name)) tools.add(t);
    // Commands that never call a model (cancel) do not start the servers.
    if (opts.model) mcpHost(file, Boolean(opts.hooks))?.attach(tools);
    const timeline = createTimeline(st, { live: true });
    let pre = opts.taskId;
    const runtime = createRuntime({
      store,
      model,
      // Browser tools share one page, so helpers working side by side cannot use them.
      // A how-to is the user's lesson from their own correction: helpers never save one.
      helperTools: (t) => !t.name.startsWith('browser_') && t.name !== 'save_howto',
      helperRoles,
      helpersAct,
      systemPrompt: [
        SYSTEM_PROMPT,
        ...(browserOn() ? [BROWSER_HINT] : []),
        ...(tools.get('web_search') ? [] : [NO_SEARCH_HINT]),
        SKILLS_HINT,
        SAVE_SKILL_HINT,
        ...(personaliseOn(home) ? [HOWTO_HINT] : []),
      ].join('\n\n'),
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
        if (e.event.type === 'approval.requested' && e.event.parked === 1) firstCard?.();
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
  /** Set by a background worker: called when the first approval card of a task starts waiting. */
  let firstCard: (() => void) | undefined;

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
    // The task carries on while a card waits, so say so when the first one does.
    const prompt = fold(await store.read(id)).prompt;
    firstCard = () =>
      notify(cardNotification({ id, prompt }), {
        env,
        ...(deps.platform && { platform: deps.platform }),
        ...(deps.notifyRun && { run: deps.notifyRun }),
      });
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

  const trustNow = (): TrustLevel => loadPrefs(home).trust ?? 'ask';

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
    const forMs = flags.for !== undefined ? parseDuration(flags.for) : undefined;
    const netAllow = list(flags['net-allow']) ?? file.netAllow;
    const always = standingNames();
    return {
      model: modelId,
      permissions: {
        autoApprove,
        // Read now, at the start of the task; the task keeps it for its whole life.
        ...(trustNow() !== 'ask' && { trust: trustNow() }),
        ...(netAllow && { netAllow }),
        ...(always.length && { standing: always }),
      },
      budget: {
        ...DEFAULT_BUDGET,
        ...file.budget,
        ...(long && { ...long }),
        ...(forMs !== undefined && forBudget(forMs)),
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
    /** The last registry answer, so a chosen name can be turned back into a plan. */
    const found = new Map<string, RegistryApp>();
    const connectFlow: ConnectFlowApi = {
      async search(query) {
        const apps = await searchRegistry(query, {
          limit: 20,
          ...(deps.fetch && { fetch: deps.fetch }),
        });
        found.clear();
        for (const a of apps) found.set(a.name, a);
        return apps.map((a) => ({
          id: a.name,
          label: a.title,
          blurb: a.kind === 'remote' ? (a.url ?? '') : [a.command, ...(a.args ?? [])].join(' '),
        }));
      },
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
        if ('registry' in a) {
          const app = found.get(a.registry);
          if (!app) throw new Error('That app is no longer in the list. Search again.');
          return planFromRegistry(app, { taken });
        }
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
      trust: {
        get: trustNow,
        set: (level) => savePrefs(home, { trust: level }),
      },
      runtime: (hooks) => {
        const made = makeRuntime(file, { model, hooks });
        registry = made.tools;
        return made.runtime;
      },
      effectOf: (tool) => registry?.get(tool)?.effect,
      riskOf: (tool) => registry?.get(tool)?.risk,
      approvals: standing(),
      skills: () => plainSkills(skills().all(), skills().problems(), skills().disabled()),
      schedules: () => plainSchedules(openSchedules(home).list()),
      review: async (window) => {
        const now = new Date();
        const since = parseSince(window ?? '24h', now);
        if (!since) throw new Error('Use /review 24h, 7d or a date such as 2026-11-01.');
        return formatReview(
          await collectReview({ store, home, since, schedules: openSchedules(home).list() }),
          since,
        );
      },
      config: (context) => taskConfig(file, model.id, workspace, context),
      listTasks: async () => (await store.listTasks()).filter((t) => !isHelperTask(t.taskId)),
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
    // Keys in the Keychain are read here only for the commands that show search status.
    if (command === 'search') await Promise.all([prepareSearch(), prepareReader()]);
    else if (command === 'doctor') await prepareSearch();
    switch (command) {
      case 'computer':
        return await computerCommand({
          rest,
          flags: {
            docker: flags.docker,
            container: flags.container,
            ssh: flags.ssh,
            key: flags.key,
            network: flags.network,
          },
          list: () => cfg().computers ?? [],
          configPath:
            [join(cwd, 'remy.config.json'), join(home, 'remy.config.json')].find(existsSync) ??
            join(home, 'remy.config.json'),
          out: deps.out,
        });

      case 'search':
        return await searchCommand({
          rest,
          keyStdin: Boolean(flags['key-stdin']),
          env: searchEnv,
          isTTY: deps.isTTY,
          out: deps.out,
          plan: searchPlan(cfg()),
          sources: searchSources as Record<KeyRoute, KeySource>,
          extra: [...(readerSetup?.lines ?? []), '', ...browserKeyLines],
          readStdin: deps.readStdin,
          askSecret: deps.askSecret,
        });

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
          if (flags.for !== undefined) out(st.dim(forNotice(config.budget)));
          startBackground(id);
          return 0;
        }
        if (flags.for !== undefined) out(st.dim(forNotice(config.budget)));
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

      case 'trust': {
        const want = rest[0];
        if (want === undefined) {
          out(trustSummary(trustNow()));
          return 0;
        }
        if (!isTrustLevel(want)) throw new Error('Use remy trust ask, steady or away.');
        if (!savePrefs(home, { trust: want })) throw new Error('Could not save the trust level.');
        out(trustChanged(want));
        return 0;
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

      case 'skills': {
        const sub = rest[0] ?? 'list';
        if (sub === 'list') {
          out(plainSkills(skills().all(), skills().problems(), skills().disabled()));
          return 0;
        }
        if (sub === 'show') {
          need(2, 'remy skills show <name>');
          const hit = skills()
            .all()
            .find((s) => s.name === rest[1]);
          if (!hit) throw new Error(`There is no skill named ${rest[1]}. See remy skills list.`);
          out(plainSkill(hit));
          return 0;
        }
        if (sub === 'find') {
          need(2, 'remy skills find <query> [--bots]');
          const q = rest.slice(1).join(' ');
          const found = await (flags.bots ? searchBots : searchSkillsSh)(q, {
            limit: 10,
            ...(deps.fetch && { fetch: deps.fetch }),
          });
          if (!found.length) {
            out(`Nothing found for "${q}".`);
            return 0;
          }
          for (const r of found) {
            out(`${r.name}${r.detail ? `  (${r.detail})` : ''}`);
            if (r.description) out(`  ${r.description}`);
            out(`  ${r.url}`);
            out(`  ${addCommand(r)}`);
            out();
          }
          out(
            'Anyone can publish to these directories and nothing is checked for you. add shows the text first, and a skill is text only.',
          );
          return 0;
        }
        if (sub === 'add') {
          need(2, 'remy skills add <folder, link, skills.sh:owner/repo/skill or bot:slug>');
          const where = rest[1] as string;
          const fromWeb = /^[a-z]+:\/\//i.test(where);
          const ref = parseDirectoryRef(where);
          const c = ref
            ? await prepareFromDirectory(ref.source, ref.id, {
                skills: skills(),
                ...(deps.fetch && { fetch: deps.fetch }),
              })
            : fromWeb
              ? await fetchSkill(where).then((f) => skills().prepareWeb(f.text, f.origin))
              : skills().prepare(where);
          out(plainSkill(c.skill));
          if (c.origin)
            out(
              `\nFrom ${c.origin.url}${c.origin.commit ? ` at commit ${c.origin.commit.slice(0, 12)}` : ''}. Only the text is saved. Reading this skill counts as untrusted, so actions need your approval.`,
            );
          out();
          if (c.skipped.length)
            out(
              `Only SKILL.md is copied; skills are instructions only. Not copied: ${c.skipped.join(', ')}.`,
            );
          if (c.replaces) out(`This replaces your skill ${c.skill.name}.`);
          if (!flags.yes && !(deps.isTTY && deps.ask))
            throw new Error('Review the skill above, then run again with --yes.');
          const yes =
            flags.yes ||
            /^y(es)?$/i.test(((await deps.ask?.('Add this skill? [y/N] ')) ?? '').trim());
          if (!yes) {
            out('Nothing was added.');
            return 1;
          }
          out(`Added ${c.skill.name}: ${skills().install(c)}`);
          return 0;
        }
        if (sub === 'update') {
          need(2, 'remy skills update <name>');
          const name = rest[1] as string;
          const saved = skills().web(name);
          if (!saved)
            throw new Error(`${name} did not come from a link, so there is nothing to update.`);
          const fresh = await fetchSkill(saved.origin.url);
          if (fresh.text === saved.text) {
            out(`${name} is up to date.`);
            return 0;
          }
          const c = skills().prepareWeb(fresh.text, fresh.origin);
          out(`${name} has changed. New text:\n`);
          out(c.text);
          if (!flags.yes && !(deps.isTTY && deps.ask))
            throw new Error('Review the text above, then run again with --yes.');
          const yes =
            flags.yes ||
            /^y(es)?$/i.test(((await deps.ask?.('Use the new text? [y/N] ')) ?? '').trim());
          if (!yes) {
            out('Nothing changed.');
            return 1;
          }
          skills().install(c);
          out(`Updated ${name}.`);
          return 0;
        }
        if (sub === 'rm' || sub === 'remove') {
          need(2, 'remy skills rm <name>');
          const name = rest[1] as string;
          if (!skills().remove(name))
            throw new Error(
              `You have no skill named ${name}. Built-in and project skills cannot be removed here.`,
            );
          out(`Removed ${name}.`);
          return 0;
        }
        throw new Error(
          'Use remy skills list, show <name>, find <query>, add <folder or link>, update <name> or rm <name>.',
        );
      }

      case 'improve':
        return improve(
          rest[0],
          rest[1],
          {
            ...(flags.from && { from: flags.from }),
            ...(flags['max-usd'] !== undefined && { 'max-usd': flags['max-usd'] }),
            ...(flags.suite && { suite: flags.suite }),
            ...(flags.model && { model: flags.model }),
            ...(flags.profile && { profile: flags.profile }),
          },
          { home, cwd, env, out, model: deps.model, ask: deps.ask, isTTY: deps.isTTY },
        );

      case 'doctor': {
        const facts = machineFacts();
        const checks = runChecks(facts);
        out(plainChecks(checks));
        const reach = readReachFacts({
          home,
          browser: facts.browser,
          keySearch: facts.search.order.some((r) => r !== 'vm' && r !== 'browser'),
        });
        out(`\n${reachLines(recommendReach(reach)).join('\n')}`);
        return checks.some((c) => c.status === 'problem') ? 1 : 0;
      }

      case 'review': {
        const now = new Date();
        const since = parseSince(flags.since ?? '24h', now);
        if (!since) throw new Error('Use --since 24h, 7d or a date such as 2026-11-01.');
        out(
          formatReview(
            await collectReview({
              store,
              home,
              since,
              schedules: openSchedules(home).list(),
            }),
            since,
          ),
        );
        return 0;
      }

      case 'schedule': {
        const store = openSchedules(home);
        const sub = rest[0] ?? 'list';
        if (sub === 'list') {
          out(plainSchedules(store.list()));
          return 0;
        }
        if (sub === 'add') {
          need(3, 'remy schedule add "<when>" "<prompt>"');
          const s = store.add(rest[1] as string, rest.slice(2).join(' '), new Date());
          out(`Scheduled ${s.id}. Next run: ${new Date(s.nextRun).toLocaleString()}.`);
          out(st.dim('It runs while remy daemon is on. Turn that on with remy daemon install.'));
          return 0;
        }
        if (sub === 'rm' || sub === 'remove') {
          need(2, 'remy schedule rm <id>');
          if (!store.remove(rest[1] as string)) throw new Error(`There is no schedule ${rest[1]}.`);
          out(`Removed ${rest[1]}.`);
          return 0;
        }
        if (sub === 'run') {
          need(2, 'remy schedule run <id>');
          const s = store.list().find((x) => x.id === rest[1]);
          if (!s) throw new Error(`There is no schedule ${rest[1]}.`);
          return await cli(['run', '--background', s.prompt], deps);
        }
        if (sub === 'pause' || sub === 'resume') {
          need(2, `remy schedule ${sub} <id>`);
          if (!store.setPaused(rest[1] as string, sub === 'pause'))
            throw new Error(`There is no schedule ${rest[1]}.`);
          out(`${sub === 'pause' ? 'Paused' : 'Resumed'} ${rest[1]}.`);
          return 0;
        }
        throw new Error('Use remy schedule list, add, run, rm, pause or resume.');
      }

      case 'webhook': {
        const hooks = openHooks(home);
        const sub = rest[0] ?? 'list';
        const known = (name: string | undefined) => {
          const hook = name ? hooks.get(name) : undefined;
          if (!hook)
            throw new Error(
              `There is no hook ${name ?? ''}. See remy webhook list.`.replace('  ', ' '),
            );
          return hook;
        };
        /** Saves a task for the hook. The payload is data: the run starts tainted, read-only, at ask. */
        const hookTask = async (name: string | undefined, payload: string) => {
          const hook = known(name);
          const file = cfg();
          const id = `task_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
          const { runtime } = makeRuntime(file, { model: true, taskId: id });
          const model = deps.model ?? modelFor(file);
          const { prompt, data } = webhookPrompt(hook, payload.slice(0, BODY_MAX_BYTES));
          const config = webhookConfig(
            taskConfig(file, model.id, join(home, 'workspaces', id)),
            data,
          );
          mkdirSync(config.workspaceDir, { recursive: true });
          await mcp?.ready;
          await runtime.start(prompt, config);
          return { id, runtime, config };
        };
        if (sub === 'list') {
          const all = hooks.list();
          out(
            all.length
              ? all
                  .map(
                    (h) =>
                      `${h.name}  ${h.tokenHash ? 'own token' : 'shared token'}  ${truncate(h.prompt, 60)}`,
                  )
                  .join('\n')
              : 'No webhooks yet. Add one with remy webhook add <name> "<prompt>".',
          );
          out(
            st.dim(
              hooks.enabled()
                ? 'Listening is on while remy daemon runs.'
                : 'Listening is off. Turn it on with remy webhook enable.',
            ),
          );
          return 0;
        }
        if (sub === 'add') {
          need(3, 'remy webhook add <name> "<prompt>"');
          const h = hooks.add(rest[1] as string, rest.slice(2).join(' '), new Date());
          out(
            `Saved ${h.name}. Call it with POST /hook/${h.name} and your token (remy webhook token).`,
          );
          if (!hooks.enabled())
            out(st.dim('Nothing listens yet. Turn it on with remy webhook enable.'));
          return 0;
        }
        if (sub === 'rm' || sub === 'remove') {
          need(2, 'remy webhook rm <name>');
          if (!hooks.remove(rest[1] as string)) throw new Error(`There is no hook ${rest[1]}.`);
          out(`Removed ${rest[1]}.`);
          return 0;
        }
        if (sub === 'enable' || sub === 'disable') {
          hooks.setEnabled(sub === 'enable');
          out(
            sub === 'enable'
              ? 'Webhooks are on. They listen on 127.0.0.1 while remy daemon runs, or run remy webhook start. Restart the daemon to pick this up.'
              : 'Webhooks are off. Restart the daemon to stop listening.',
          );
          return 0;
        }
        if (sub === 'token') {
          const name = rest[1];
          if (name) {
            known(name);
            if (flags.shared) {
              hooks.setTokenHash(name, undefined);
              out(`${name} uses the shared token again.`);
              return 0;
            }
            const token = newToken();
            hooks.setTokenHash(name, sha256Hex(token));
            out(token);
            out(st.dim(`This token opens only ${name}. It is shown once and is not saved.`));
            return 0;
          }
          out(flags.rotate ? rotateToken(home) : sharedToken(home));
          if (flags.rotate) out(st.dim('The old shared token no longer works.'));
          return 0;
        }
        if (sub === 'run') {
          // Started by the listener, with the payload on stdin. Never typed by hand.
          const { id } = await hookTask(rest[1], (await deps.readStdin?.()) ?? '');
          startBackground(id);
          return 0;
        }
        if (sub === 'test') {
          need(2, 'remy webhook test <name> [--data <file>]');
          const payload = flags.data ? readFileSync(resolve(cwd, flags.data), 'utf8') : '';
          const { id, runtime, config } = await hookTask(rest[1], payload);
          out(st.dim(`Task ${id}, run here without a socket. Workspace ${config.workspaceDir}`));
          return await drive(runtime, id);
        }
        if (sub === 'start') {
          if (!hooks.enabled() || !hooks.list().length)
            throw new Error(
              'Turn webhooks on and add a hook first: remy webhook add, then remy webhook enable.',
            );
          const entry = deps.entry ?? currentEntry();
          const listening = await startWebhooks({
            home,
            env,
            ...(flags.bind && { bind: flags.bind }),
            ...(flags.port && { port: flags.port }),
            start: processStarter({ entry, env, cwd: home }),
            isActive: async (id) =>
              ['running', 'waiting_approval', 'waiting_user', 'paused'].includes(
                fold(await store.read(id)).status,
              ),
            log: (line) => out(line),
          });
          out(
            `Webhooks listen on http://${listening.host}:${listening.port}/hook/<name>. Press Ctrl+C to stop.`,
          );
          await new Promise(() => {});
        }
        throw new Error('Use remy webhook list, add, rm, token, enable, disable, start or test.');
      }

      case 'serve': {
        if (rest[0] === 'token') {
          if (serveTokenHash(home) && !flags.rotate) {
            out(
              'A token already exists. It is shown once, when it is made. For a new one (the old one stops working): remy serve token --rotate',
            );
            return 0;
          }
          out(makeServeToken(home));
          out(st.dim('Shown once. Send it as: Authorization: Bearer <token>'));
          return 0;
        }
        if (rest[0]) throw new Error('Use remy serve, or remy serve token [--rotate].');
        // The address is checked first, so a refused one never opens the store or a connection.
        const bind = resolveServeBind({ host: flags.host, port: flags.port }, env);
        const file = cfg();
        const model = deps.model ?? modelFor(file);
        const { runtime } = makeRuntime(file, { model: true, hooks: {} });
        await mcp?.ready;
        if (!serveTokenHash(home)) {
          announceFirstRunToken(home, makeServeToken(home), deps.isTTY, (line) =>
            out(line.startsWith('That is') ? st.dim(line) : line),
          );
        }
        const webPrefs = openWebPrefs(home, () => loadPrefs(home).trust);
        // Only for the Settings screen's provider line; a model passed in by a test has no profile.
        const provider = (() => {
          try {
            return providerEnv(file).REMY_PROFILE;
          } catch {
            return undefined;
          }
        })();
        const voiceLedger = openVoiceLedger(home, undefined, (line) => out(st.dim(line)));
        const spend = createSpend(store, undefined, (at) => voiceLedger.monthUsd(at));
        let monthLeft = Number.POSITIVE_INFINITY; // set by beforeStart, read by config
        // Read on each use (a short while cached, never blocking the server), so a key added later
        // works without a restart. A slow or locked Keychain reads as "no key".
        const fishKeys = createFishKeySource(() => readFishKeyAsync(env, process.platform));
        const fishKey = fishKeys.get;
        void fishKeys.get(); // warm the cache so Settings can say whether voice is ready
        const notesCount = () => {
          try {
            return memory().list().length;
          } catch {
            return null;
          }
        };
        const notesToday = () => {
          try {
            const midnight = new Date();
            midnight.setHours(0, 0, 0, 0);
            return memory()
              .list()
              .filter((n) => new Date(n.created) >= midnight).length;
          } catch {
            return null;
          }
        };
        const listening = await listenServe(
          {
            routes: [
              homeRoutes({
                store,
                prefs: webPrefs,
                spend,
                redact,
                machines: () => file.computers?.length ?? 0,
                notesCount,
                notesToday,
              }),
              reviewRoutes({
                store,
                home,
                prefs: webPrefs,
                schedules: () => openSchedules(home).list(),
              }),
              actionRoutes({
                store,
                prefs: webPrefs,
                redact,
                notes: { count: () => memory().list().length, clear: () => memory().clear() },
                rotateToken: () => makeServeToken(home),
                model,
              }),
              chatRoutes({ home, store, redact }),
              settingsRoutes(
                {
                  home,
                  store,
                  prefs: webPrefs,
                  version: version(),
                  provider,
                  modelId: model.id,
                  pricing: model.caps.pricing,
                  address: () => `${bind.host}:${bind.port}`,
                  notesCount,
                  needsKey: (p) => Boolean(PROFILES[p]?.keyEnv),
                  voiceReady: () => Boolean(fishKeys.peek()),
                  workspaceFlag: flags.workspace ? resolve(cwd, flags.workspace) : undefined,
                  userHome: deps.homeDir ?? homedir(),
                },
                spend,
              ),
            ],
            store,
            runtime,
            home,
            version: version(),
            config: (id, trust) => {
              // --workspace points every web task at one folder (say, ~/Desktop); else the folder
              // saved in Settings; else a new empty folder for this task.
              const { folder } = chooseWorkspace(
                flags.workspace ? resolve(cwd, flags.workspace) : undefined,
                webPrefs.get().workspace,
                join(home, 'workspaces', id),
              );
              const config = taskConfig(file, model.id, folder);
              mkdirSync(config.workspaceDir, { recursive: true });
              // beforeStart ran just before this, in the same turn, and left what the month has left.
              return capToMonthRemaining(
                configWithPrefs(config, webPrefs.chosen(), trust),
                monthLeft,
              );
            },
            beforeStart: async () => {
              await assertUnderMonthlyCap(webPrefs, spend);
              monthLeft = await monthRemaining(webPrefs, spend);
            },
            tokenHash: () => serveTokenHash(home),
            redact,
            alwaysAllow: (tool, risk) => standing().add(tool, risk),
            log: (line) => out(st.dim(line)),
            mounts: [
              createConnectMount({
                home,
                cwd: deps.cwd,
                userHome: deps.homeDir ?? homedir(),
                fromConfig: () => cfg().mcpServers ?? {},
                ...(mcp && { host: mcp }),
                secrets: secretsFor(),
                computers: () => cfg().computers ?? [],
                // The file Remy reads: the folder's own, else the one in REMY_HOME.
                saveComputers: (list) =>
                  writeComputers(
                    [join(deps.cwd, 'remy.config.json'), join(home, 'remy.config.json')].find(
                      existsSync,
                    ) ?? join(home, 'remy.config.json'),
                    list,
                  ),
              }),
              createSkillsMount({ skills: skills(), ...(deps.fetch && { fetch: deps.fetch }) }),
              createBrowserMount({ browser: () => browser, redact }),
              createSearchMount({
                prefs: webPrefs,
                redact,
                searchStatus: async (): Promise<SearchStatusView> => {
                  const f = cfg();
                  const [keys, rd, bs] = await Promise.all([
                    resolveSearchKeys(env, keyOpts),
                    resolveReader(env, keyOpts),
                    remoteBrowserStatus(env, keyOpts),
                  ]);
                  for (const k of [...keys.found, ...rd.found, ...bs.found])
                    addSecret(k.name, k.value);
                  const plan = planFor(f, keys.env);
                  const reader = (id: 'firecrawl' | 'cloudflare') =>
                    id === 'firecrawl'
                      ? rd.sources.firecrawl
                      : rd.sources.cloudflare !== 'none' &&
                          rd.sources['cloudflare-account'] !== 'none'
                        ? rd.sources.cloudflare
                        : 'none';
                  return {
                    chosen: plan.chosen ?? null,
                    ...(plan.why && { why: plan.why }),
                    ...(plan.step && { step: plan.step }),
                    order: plan.order,
                    override: plan.override ? (env.REMY_SEARCH ?? f.search ?? null) : null,
                    services: [
                      ...(Object.keys(SERVICES) as KeyRoute[]).map((id) => ({
                        id,
                        label: SERVICES[id].label,
                        key: keys.sources[id],
                        kind: 'search' as const,
                      })),
                      {
                        id: 'firecrawl',
                        label: 'Firecrawl',
                        key: reader('firecrawl'),
                        kind: 'reader' as const,
                        note: 'Reads pages Remy cannot read directly.',
                      },
                      {
                        id: 'cloudflare',
                        label: 'Cloudflare Browser Rendering',
                        key: reader('cloudflare'),
                        kind: 'reader' as const,
                        note: 'Reads pages Remy cannot read directly. Needs an account id and a token.',
                      },
                      {
                        id: 'steel',
                        label: 'Steel',
                        key: bs.sources.steel,
                        kind: 'browser' as const,
                        note: 'A cloud browser, used when REMY_BROWSER=steel.',
                      },
                      {
                        id: 'browserbase',
                        label: 'Browserbase',
                        key:
                          bs.sources['browserbase-project'] === 'none'
                            ? 'none'
                            : bs.sources.browserbase,
                        kind: 'browser' as const,
                        note: 'A cloud browser, used when REMY_BROWSER=browserbase. Needs a project id.',
                      },
                    ],
                  };
                },
                testSearch: async (id) => {
                  if (!Object.hasOwn(SERVICES, id))
                    throw new Error('That is not a search service.');
                  const keys = await resolveSearchKeys(env, keyOpts);
                  for (const k of keys.found) addSecret(k.name, k.value);
                  return makeService(id as KeyRoute, keys.env).search(TEST_QUERY, 3);
                },
              }),
              createVoiceMount({
                key: fishKey,
                voiceId: () => webPrefs.get().voice.id,
                ledger: voiceLedger,
                assertBudget: () => assertUnderMonthlyCap(webPrefs, spend),
                onKey: (k) => addSecret('FISH_API_KEY', k),
              }),
              createBrainMount({ memory: memory(), semantic: noteEmbedder().source }),
              createSchedulesMount({
                schedules: openSchedules(home),
                hooks: openHooks(home),
                webhookPort: Number(env.REMY_WEBHOOK_PORT) || DEFAULT_WEBHOOK_PORT,
                trust: trustNow,
                maxCostUsd: () => taskConfig(file, model.id, home).budget.maxCostUsd,
              }),
            ],
          },
          bind,
        );
        out(
          `remy serve listens on http://${listening.host}:${listening.port}. Press Ctrl+C to stop.`,
        );
        await (deps.serveStop ?? new Promise<void>(() => {}));
        await listening.close();
        return 0;
      }

      case 'daemon': {
        const sub = rest[0];
        const entry = deps.entry ?? currentEntry();
        const installer = daemonInstaller();
        if (sub === 'install' || sub === 'uninstall' || sub === 'status') {
          if (!installer)
            throw new Error(
              'remy daemon install has no service for this system. Run remy daemon run in your own service.',
            );
          out(
            sub === 'install'
              ? installer.install()
              : sub === 'uninstall'
                ? installer.uninstall()
                : installer.status().message,
          );
          return 0;
        }
        if (sub && sub !== 'run')
          throw new Error('Use remy daemon, or remy daemon install, uninstall or status.');
        const schedules = openSchedules(home);
        const start = (prompt: string) =>
          new Promise<string>((done, fail) => {
            execFile(
              entry.execPath,
              [...entry.execArgv, entry.script, 'run', '--background', prompt],
              { env, cwd: home },
              (e, stdout) => {
                if (e) return fail(e);
                done(/task_[a-f0-9]+/.exec(stdout)?.[0] ?? '');
              },
            );
          });
        await daemonWebhooks({
          home,
          env,
          start: processStarter({ entry, env, cwd: home }),
          isActive: async (id) =>
            ['running', 'waiting_approval', 'waiting_user', 'paused'].includes(
              fold(await store.read(id)).status,
            ),
          log: (line) => out(line),
        });
        out('The daemon is running. Press Ctrl+C to stop it.');
        for (;;) {
          await tick(schedules, new Date(), start, (line) => out(line));
          await new Promise((r) => setTimeout(r, TICK_MS));
        }
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
        const tasks = (await store.listTasks(status ? { status } : undefined)).filter(
          (t) => !isHelperTask(t.taskId),
        );
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
        if (sub === 'vm') {
          const action = rest[1] ?? 'status';
          if (action === 'stop') {
            stopVm(vmRun);
            rmSync(vmFile(), { force: true });
            out('Search in the container is off.');
            return 0;
          }
          if (action === 'status') {
            out(`Search in the container: ${vmStatus(vmRun)}.`);
            return 0;
          }
          if (action !== 'start')
            throw new Error(
              'Use remy browser vm start, remy browser vm stop or remy browser vm status.',
            );
          out('Starting. The first start downloads a browser, about 2 GB.');
          await startVmSearch();
          out('Search now runs in the container, with nothing on your screen.');
          return 0;
        }
        if (sub !== 'show')
          throw new Error(
            'Use remy browser show, remy browser reset, remy browser install or remy browser vm.',
          );
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
        for (const helper of helperIds(s)) {
          const h = fold(await store.read(helper));
          out(
            st.dim(
              `Helper ${helper}: ${h.status}, ${h.step} steps. ${truncate(h.final?.answer ?? '', 80)}`,
            ),
          );
        }
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

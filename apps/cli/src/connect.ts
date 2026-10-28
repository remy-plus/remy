// `remy connect`: add, list and remove the servers Remy can use, and import them from other apps.
// Adding a local server is code execution, so it shows the exact command and needs a yes.
import { isStdio, type McpServerConfig } from '@remy/mcp';
import {
  applyPlan,
  type ConnectPlan,
  planCustom,
  planFromEntry,
  suggestName,
  takenNames,
} from './connect-plan.ts';
import { CATALOG } from './mcp-catalog.ts';
import {
  commandLine,
  loadSaved,
  mergeServers,
  removeSaved,
  saveSaved,
  serverSecretRefs,
} from './mcp-config.ts';
import {
  type FoundServer,
  type ImportScan,
  type ImportSource,
  mergeScans,
  parseImport,
  secretize,
} from './mcp-import.ts';
import { hasOAuthTokens, signIn } from './mcp-oauth.ts';
import { SECRET_NAME, type SecretStore } from './mcp-secrets.ts';

export const CONNECT_USAGE = `Usage
  remy connect                                      Pick an app or service from a short list
  remy connect add <name> -- <command> [args...]    A local server (this runs code on your computer)
  remy connect add <name> --url <url> [--header K=V]  A remote server
      --oauth             The server asks you to sign in in a browser (done right away)
      --env K=V           Plain environment value for a local server
      --secret KEY        Ask for a token and keep it in the Keychain (--secret-stdin to pipe it)
      --yes               Skip the question (for scripts)
  remy connect auth <name> [--no-browser] [--force] Sign in to a remote server in your browser
  remy connect list                                 Show what is connected
  remy connect remove <name>                        Forget a server and its saved secrets
  remy connect --import [name...] [--yes]           Bring in servers from Claude Desktop or Claude Code`;

export interface ConnectFlags {
  url?: string | undefined;
  header?: string[] | undefined;
  env?: string[] | undefined;
  secret?: string[] | undefined;
  'secret-stdin'?: boolean | undefined;
  yes?: boolean | undefined;
  oauth?: boolean | undefined;
  'no-browser'?: boolean | undefined;
  force?: boolean | undefined;
  import?: boolean | undefined;
}

export interface ConnectCtx {
  /** The words after `connect`: the subcommand, the name, and anything else not a flag. */
  rest: string[];
  flags: ConnectFlags;
  /** Everything after `--` on the command line, when there was a `--`. */
  commandArgs: string[] | undefined;
  home: string;
  cwd: string;
  secrets: SecretStore;
  /** `mcpServers` from remy.config.json, for `list`. */
  fromConfig: Record<string, McpServerConfig>;
  /** Where other apps keep their servers (see `importSources`). */
  sources: ImportSource[];
  /** Reads a file as text; undefined when it is not there. */
  readText: (path: string) => string | undefined;
  isTTY: boolean;
  /** Asks one line; null when input has ended. */
  ask?: ((question: string) => Promise<string | null>) | undefined;
  /** Asks for a value without showing it. */
  askSecret?: ((question: string) => Promise<string | null>) | undefined;
  readStdin?: (() => Promise<string>) | undefined;
  out: (line: string) => void;
  /** Opens a sign-in page in the browser; false when it could not. Default: the system's. */
  openUrl?: ((url: string) => Promise<boolean>) | undefined;
  fetch?: typeof fetch | undefined;
  signInTimeoutMs?: number | undefined;
  /** The user's real home folder, for `~` in a chosen folder. */
  userHome?: string | undefined;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/** `K=V` pairs into a record. A value may hold `=`; a key may not be empty. */
export function parsePairs(pairs: string[] | undefined, what: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const at = p.indexOf('=');
    if (at < 1) throw new Error(`${what} "${p}" should look like KEY=value.`);
    out[p.slice(0, at)] = p.slice(at + 1);
  }
  return out;
}

const isLocalHost = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/** The server a `connect add` describes, before any secret values exist. */
export function buildServer(
  name: string,
  flags: ConnectFlags,
  commandArgs: string[] | undefined,
): { config: McpServerConfig; secretKeys: string[] } {
  if (!NAME.test(name))
    throw new Error(
      `"${name}" is not a usable name. Use letters, digits, - and _, starting with a letter or digit.`,
    );
  const secretKeys = flags.secret ?? [];
  const refFor = (key: string) => `\${secret:${name}.${key}}`;
  for (const key of secretKeys)
    if (!SECRET_NAME.test(`${name}.${key}`))
      throw new Error(`--secret ${key}: use letters, digits, _ . and - only.`);
  const refs = Object.fromEntries(secretKeys.map((k) => [k, refFor(k)]));
  const command = commandArgs?.[0];
  if (command && flags.url) throw new Error('Give either a command (after --) or --url, not both.');
  if (command) {
    if (flags.header?.length) throw new Error('--header goes with --url.');
    if (flags.oauth) throw new Error('--oauth goes with --url.');
    const env = { ...parsePairs(flags.env, '--env'), ...refs };
    return {
      config: {
        command,
        ...(commandArgs.length > 1 && { args: commandArgs.slice(1) }),
        ...(Object.keys(env).length && { env }),
      },
      secretKeys,
    };
  }
  if (!flags.url)
    throw new Error(
      `Say what to connect: a command after -- (remy connect add ${name} -- npx -y <package>) or --url <url>.`,
    );
  if (flags.env?.length) throw new Error('--env goes with a command after --.');
  let url: URL;
  try {
    url = new URL(flags.url);
  } catch {
    throw new Error(`"${flags.url}" is not a URL. It should start with https://.`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url)))
    throw new Error('A remote server must use https://. Use http:// only for localhost.');
  const headers = { ...parsePairs(flags.header, '--header'), ...refs };
  return {
    config: {
      url: flags.url,
      ...(Object.keys(headers).length && { headers }),
      ...(flags.oauth && { auth: 'oauth' as const }),
    },
    secretKeys,
  };
}

const kind = (c: McpServerConfig) => (isStdio(c) ? 'local' : 'remote');

/** Asks a yes/no; `--yes` answers it. Without a terminal and without --yes it says why it stopped. */
async function confirm(ctx: ConnectCtx, question: string, why: string): Promise<boolean> {
  if (ctx.flags.yes) return true;
  if (!ctx.isTTY || !ctx.ask) throw new Error(`${why} Review it above, then run again with --yes.`);
  const a = await ctx.ask(`${question} [y/N] `);
  return a !== null && /^y(es)?$/i.test(a.trim());
}

async function add(ctx: ConnectCtx): Promise<number> {
  const name = ctx.rest[1];
  if (!name)
    throw new Error(`Usage: remy connect add <name> -- <command> [args...]\n${CONNECT_USAGE}`);
  const { config, secretKeys } = buildServer(name, ctx.flags, ctx.commandArgs);
  const saved = loadSaved(ctx.home);
  if (name in saved.mcpServers || name in ctx.fromConfig)
    throw new Error(
      `There is already a server named ${name}. Remove it first: remy connect remove ${name}.`,
    );
  if (ctx.flags['secret-stdin'] && secretKeys.length !== 1)
    throw new Error('--secret-stdin takes exactly one --secret KEY.');

  if (isStdio(config)) {
    ctx.out('Remy will run this on your computer, with your permissions, each time it starts:');
    ctx.out(`  ${commandLine(config)}`);
    if (
      !(await confirm(ctx, 'Add this server?', 'Adding a local server runs code on your computer.'))
    ) {
      ctx.out('Nothing was added.');
      return 1;
    }
  } else ctx.out(`Remy will connect to ${config.url}.`);

  const stored: string[] = [];
  for (const key of secretKeys) {
    let value: string | null | undefined;
    if (ctx.flags['secret-stdin']) value = (await ctx.readStdin?.())?.trim();
    else if (ctx.askSecret) value = await ctx.askSecret(`${key} (hidden): `);
    else
      throw new Error(`${key} needs a value. Run in a terminal, or pipe it with --secret-stdin.`);
    if (!value) throw new Error(`No value was given for ${key}. Nothing was added.`);
    const where = ctx.secrets.set(`${name}.${key}`, value);
    stored.push(
      `${key} in ${where === 'keychain' ? 'the macOS Keychain' : 'REMY_HOME (private file)'}`,
    );
  }
  saveSaved(ctx.home, { ...saved, mcpServers: { ...saved.mcpServers, [name]: config } });
  ctx.out(`Added ${name}${stored.length ? `. Saved ${stored.join(', ')}` : ''}.`);
  if (!isStdio(config) && config.auth === 'oauth')
    return authenticate(ctx, name, config.url, false);
  ctx.out('Remy connects to it the next time it starts. Check with remy connect list.');
  return 0;
}

/** Runs the browser sign-in for one remote server and says how it went. */
async function authenticate(
  ctx: ConnectCtx,
  name: string,
  url: string,
  force: boolean,
): Promise<number> {
  ctx.out(`Signing in to ${name}. Waiting for the browser; Ctrl+C stops.`);
  const r = await signIn(
    name,
    url,
    {
      secrets: ctx.secrets,
      ...(ctx.openUrl && { openUrl: ctx.openUrl }),
      ...(ctx.fetch && { fetch: ctx.fetch }),
      ...(ctx.signInTimeoutMs !== undefined && { timeoutMs: ctx.signInTimeoutMs }),
    },
    {
      noBrowser: Boolean(ctx.flags['no-browser']),
      onUrl: (link, opened) =>
        ctx.out(
          opened
            ? `Opened your browser. If nothing appeared, open this link:\n  ${link}`
            : `Open this link to sign in:\n  ${link}`,
        ),
    },
    force,
  );
  if (!r.ok) {
    ctx.out(`${r.message} Run remy connect auth ${name} to try again.`);
    return 1;
  }
  ctx.out(
    r.already
      ? `${name} is already signed in. Use --force to sign in again.`
      : `Signed in to ${name}. Remy uses it the next time it starts.`,
  );
  return 0;
}

async function auth(ctx: ConnectCtx): Promise<number> {
  const name = ctx.rest[1];
  if (!name) throw new Error('Usage: remy connect auth <name> [--no-browser] [--force]');
  const saved = loadSaved(ctx.home);
  const entry = saved.mcpServers[name] ?? ctx.fromConfig[name];
  if (!entry) throw new Error(`There is no server named ${name}. Run remy connect list.`);
  if (isStdio(entry))
    throw new Error(`${name} runs on this computer, so there is nothing to sign in to.`);
  if (entry.auth !== 'oauth') {
    if (name in ctx.fromConfig && !(name in saved.mcpServers))
      throw new Error(`Add "auth": "oauth" to ${name} in remy.config.json, then run this again.`);
    saveSaved(ctx.home, {
      ...saved,
      mcpServers: { ...saved.mcpServers, [name]: { ...entry, auth: 'oauth' } },
    });
  }
  if (!ctx.flags.force && hasOAuthTokens(ctx.secrets, name)) {
    ctx.out(`${name} is already signed in. Use --force to sign in again.`);
    return 0;
  }
  return authenticate(ctx, name, entry.url, Boolean(ctx.flags.force));
}

const ENTRY_WIDTH = Math.max(...CATALOG.map((e) => e.label.length), 'Custom server'.length);

/** The picker in a terminal: a numbered list, then only the questions the choice needs. */
async function pick(ctx: ConnectCtx): Promise<number> {
  if (!ctx.isTTY || !ctx.ask) {
    ctx.out(CONNECT_USAGE);
    ctx.out('\nRun remy connect in a terminal to pick from a list.');
    return 0;
  }
  const ask = ctx.ask;
  const userHome = ctx.userHome ?? ctx.cwd;
  const taken = takenNames(ctx.home, ctx.fromConfig);
  ctx.out('What would you like to connect?');
  for (const [i, e] of CATALOG.entries())
    ctx.out(`  ${i + 1}  ${e.label.padEnd(ENTRY_WIDTH)}  ${e.blurb}`);
  const custom = CATALOG.length + 1;
  ctx.out(
    `  ${custom}  ${'Custom server'.padEnd(ENTRY_WIDTH)}  A web address or a command you have`,
  );
  const answer = (await ask(`Number, or Enter to cancel: `))?.trim();
  if (!answer) return 1;
  const n = Number(answer);
  if (!Number.isInteger(n) || n < 1 || n > custom)
    throw new Error(`"${answer}" is not on the list.`);

  let plan: ConnectPlan;
  if (n === custom) {
    const where = (await ask('Web address (https://...) or the command to run: '))?.trim();
    if (!where) return 1;
    const suggested = suggestName(where, taken);
    const typed = (await ask(`Name [${suggested}]: `))?.trim();
    plan = planCustom(where, typed || suggested, taken);
  } else {
    const entry = CATALOG[n - 1] as (typeof CATALOG)[number];
    let folder: string | undefined;
    if (entry.folder) {
      folder = (await ask(`${entry.folder.label} [${ctx.cwd}]: `))?.trim() || ctx.cwd;
    }
    plan = planFromEntry(entry, {
      taken,
      cwd: ctx.cwd,
      userHome,
      ...(folder && { folder }),
    });
  }
  const values: Record<string, string> = {};
  for (const s of plan.secrets) {
    ctx.out(`${s.label}: ${s.where}`);
    const v = ctx.askSecret ? await ctx.askSecret(`${s.label} (hidden): `) : null;
    if (!v?.trim()) throw new Error(`No ${s.label} was given. Nothing was added.`);
    values[s.key] = v;
  }
  if (plan.command) {
    ctx.out('Remy will run this on your computer, with your permissions, each time it starts:');
    ctx.out(`  ${plan.command}`);
    const yes = await ask('Add this server? [y/N] ');
    if (yes === null || !/^y(es)?$/i.test(yes.trim())) {
      ctx.out('Nothing was added.');
      return 1;
    }
  } else if (!plan.oauth) ctx.out(`Remy will connect to ${(plan.config as { url: string }).url}.`);
  const stored = applyPlan(plan, { home: ctx.home, secrets: ctx.secrets, values });
  ctx.out(`Added ${plan.name}${stored.length ? `. Saved ${stored.join(', ')}` : ''}.`);
  if (plan.oauth) return authenticate(ctx, plan.name, (plan.config as { url: string }).url, false);
  ctx.out('Remy connects to it the next time it starts. Check with remy connect list.');
  return 0;
}

function list(ctx: ConnectCtx): number {
  const rows = mergeServers(loadSaved(ctx.home), ctx.fromConfig);
  if (!rows.length) {
    ctx.out('Nothing is connected yet. Add a server: remy connect add <name> -- <command>.');
    return 0;
  }
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    const missing = serverSecretRefs(r.config).filter((s) => ctx.secrets.get(s) === undefined);
    const bits = [
      kind(r.config),
      r.disabled ? 'off' : 'on',
      r.source === 'config' ? 'remy.config.json' : 'saved',
      commandLine(r.config),
      ...(missing.length ? [`missing secret: ${missing.join(', ')}`] : []),
    ];
    ctx.out(`${r.name.padEnd(w)}  ${bits.join('  ')}`);
  }
  return 0;
}

function remove(ctx: ConnectCtx): number {
  const name = ctx.rest[1];
  if (!name) throw new Error('Usage: remy connect remove <name>');
  if (removeSaved(ctx.home, name, ctx.secrets, ctx.fromConfig)) {
    ctx.out(`Removed ${name} and the secrets only it used.`);
    return 0;
  }
  throw new Error(
    name in ctx.fromConfig
      ? `${name} is listed in remy.config.json. Remove it there.`
      : `There is no server named ${name}. Run remy connect list.`,
  );
}

/** What each source holds, merged; names already connected are left out. */
export function scanSources(ctx: ConnectCtx): ImportScan {
  const known = new Set(Object.keys({ ...loadSaved(ctx.home).mcpServers, ...ctx.fromConfig }));
  const scans = ctx.sources.flatMap((s) => {
    const text = ctx.readText(s.path);
    return text === undefined ? [] : [parseImport(s.label, text, ctx.cwd)];
  });
  const all = mergeScans(scans);
  return {
    found: all.found.filter((f) => !known.has(f.name)),
    skipped: [
      ...all.skipped,
      ...all.found
        .filter((f) => known.has(f.name))
        .map((f) => ({ name: f.name, from: f.from, why: 'already connected' })),
    ],
  };
}

const describe = (f: FoundServer) =>
  `  ${f.name}  (${kind(f.config)}, from ${f.from})  ${commandLine(f.config)}`;

async function importServers(ctx: ConnectCtx): Promise<number> {
  const scan = scanSources(ctx);
  const wanted = ctx.rest;
  const found = wanted.length ? scan.found.filter((f) => wanted.includes(f.name)) : scan.found;
  for (const s of scan.skipped) ctx.out(`Skipped ${s.name} (${s.from}): ${s.why}.`);
  if (!found.length) {
    ctx.out(
      wanted.length
        ? 'None of those names were found. Run remy connect --import to see what there is.'
        : 'No new servers found in Claude Desktop or Claude Code.',
    );
    return 0;
  }
  ctx.out(`Found ${found.length} server${found.length === 1 ? '' : 's'}:`);
  for (const f of found) ctx.out(describe(f));
  const local = found.some((f) => isStdio(f.config));
  ctx.out(
    local
      ? 'Local servers run these commands on your computer, with your permissions, each time Remy starts. Tokens move to the Keychain.'
      : 'Tokens move to the Keychain.',
  );
  if (
    !(await confirm(
      ctx,
      `Add ${found.length === 1 ? 'it' : 'them'}?`,
      'Importing adds servers that run code.',
    ))
  ) {
    ctx.out('Nothing was added.');
    return 1;
  }
  const saved = loadSaved(ctx.home);
  const next = { ...saved.mcpServers };
  for (const f of found) {
    const { config, secrets } = secretize(f.name, f.config);
    for (const [id, value] of Object.entries(secrets)) ctx.secrets.set(id, value);
    next[f.name] = config;
  }
  saveSaved(ctx.home, { ...saved, mcpServers: next });
  ctx.out(
    `Added ${found.map((f) => f.name).join(', ')}. Remy connects to them the next time it starts.`,
  );
  return 0;
}

export async function connectCommand(ctx: ConnectCtx): Promise<number> {
  if (ctx.flags.import) return importServers(ctx);
  switch (ctx.rest[0]) {
    case 'add':
      return add(ctx);
    case 'auth':
      return auth(ctx);
    case 'list':
      return list(ctx);
    case 'remove':
    case 'rm':
      return remove(ctx);
    case undefined:
      return pick(ctx);
    default:
      ctx.out(CONNECT_USAGE);
      return 1;
  }
}

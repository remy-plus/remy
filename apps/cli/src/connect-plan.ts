// What picking something to connect comes to, apart from how it is asked: a plan (the server to
// save, the secrets to ask for, the exact command to confirm), and saving it. Shared by
// `remy connect` in a terminal and /connect in the chat.
import { isStdio, type McpServerConfig } from '@remy/mcp';
import { absoluteFolder, type CatalogEntry, type CatalogSecret } from './mcp-catalog.ts';
import { commandLine, loadSaved, mergeServers, saveSaved } from './mcp-config.ts';
import { headerValue, type RegistryApp } from './mcp-registry.ts';
import { SECRET_NAME, type SecretStore } from './mcp-secrets.ts';

export const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

export interface ConnectPlan {
  name: string;
  config: McpServerConfig;
  /** Values to ask for; each is stored as the secret `<name>.<key>`. */
  secrets: CatalogSecret[];
  /** The exact command a local server runs; undefined for a remote server. */
  command?: string;
  /** Sign in to it in the browser right after saving. */
  oauth: boolean;
  /** For the first line of the summary: "GitHub", or the name for a custom server. */
  label: string;
}

/** Splits a command line into words: single and double quotes group, a backslash escapes in double quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | undefined;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quote) {
      if (ch === quote) quote = undefined;
      else if (quote === '"' && ch === '\\' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new Error('A quote is not closed.');
  if (has || cur) out.push(cur);
  return out;
}

export const takenNames = (home: string, fromConfig: Record<string, McpServerConfig> = {}) =>
  new Set(mergeServers(loadSaved(home), fromConfig).map((d) => d.name));

function checkName(name: string, taken: Set<string>): string {
  if (!SERVER_NAME.test(name))
    throw new Error(
      `"${name}" is not a usable name. Use letters, digits, - and _, starting with a letter or digit.`,
    );
  if (taken.has(name))
    throw new Error(
      `There is already a server named ${name}. Remove it first: remy connect remove ${name}.`,
    );
  return name;
}

/** A catalog entry as a plan. A folder (when the entry asks for one) must already be absolute or resolvable. */
export function planFromEntry(
  entry: CatalogEntry,
  o: { taken: Set<string>; folder?: string; cwd: string; userHome: string; name?: string },
): ConnectPlan {
  const name = checkName(o.name ?? entry.id, o.taken);
  let folder: string | undefined;
  if (entry.folder) {
    if (!o.folder?.trim()) throw new Error('Choose a folder.');
    folder = absoluteFolder(o.folder, o.cwd, o.userHome);
    if (folder === '/') throw new Error('Choose a folder, not the whole disk.');
  }
  const config = entry.build({ name, ...(folder && { folder }) });
  return {
    name,
    config,
    secrets: entry.secrets,
    ...(isStdio(config) && { command: commandLine(config) }),
    oauth: entry.auth === 'oauth',
    label: entry.label,
  };
}

const isLocalHost = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/** Registry names are reverse-DNS paths (`ac.inference.sh/mcp`); a server name cannot hold a slash. */
const GENERIC = new Set(['mcp', 'sse', 'server', 'http', 'stdio']);

/**
 * A usable server name from a registry name: the last path segment, or the one before it when that
 * segment is just `mcp`. `ac.inference.sh/mcp` becomes `ac.inference.sh`; `io.github.me/thing`
 * becomes `thing`. A name already in use gets a number, so two apps never collide.
 */
export function registryName(registry: string, taken: Set<string>): string {
  const parts = registry
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  let base = parts.at(-1) ?? 'server';
  if (GENERIC.has(base.toLowerCase()) && parts.length > 1) base = parts.at(-2) as string;
  base = base
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 36)
    .replace(/[-_.]+$/, '');
  if (!base) base = 'server';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const next = `${base}-${n}`;
    if (!taken.has(next)) return next;
  }
  throw new Error(`There are already too many servers named like ${base}.`);
}

/**
 * A registry record as a plan. The record is not trusted, so the caller still shows the exact
 * command or address and asks before anything is saved.
 */
export function planFromRegistry(
  app: RegistryApp,
  o: { taken: Set<string>; name?: string },
): ConnectPlan {
  const name = checkName(o.name ?? registryName(app.name, o.taken), o.taken);
  const secrets: CatalogSecret[] = app.secrets.map((s) => ({
    key: s.key,
    label: s.label,
    where: s.where,
  }));
  for (const s of secrets)
    if (!SECRET_NAME.test(`${name}.${s.key}`))
      throw new Error(
        `${app.title} asks for "${s.key}", which cannot be kept as a secret name. Nothing was added.`,
      );
  const ref = (key: string) => `\${secret:${name}.${key}}`;
  if (app.kind === 'remote') {
    if (!app.url) throw new Error(`${app.title} does not say where it is hosted.`);
    const headers = Object.fromEntries(
      app.secrets.map((s) => [s.key, headerValue(s.template || `{${s.key}}`, name, s.key)]),
    );
    const config: McpServerConfig = {
      url: app.url,
      ...(Object.keys(headers).length && { headers }),
    };
    return { name, config, secrets, oauth: false, label: app.title };
  }
  if (!app.command) throw new Error(`${app.title} does not say what to run.`);
  const env = Object.fromEntries(app.secrets.map((s) => [s.key, ref(s.key)]));
  const config: McpServerConfig = {
    command: app.command,
    ...(app.args?.length && { args: app.args }),
    ...(Object.keys(env).length && { env }),
  };
  return { name, config, secrets, command: commandLine(config), oauth: false, label: app.title };
}

/** What a custom server's first line means: a web address is remote, anything else is a command. */
export function planCustom(input: string, name: string, taken: Set<string>): ConnectPlan {
  const text = input.trim();
  if (!text) throw new Error('Give a web address or a command.');
  checkName(name, taken);
  if (/^https?:\/\//i.test(text) && !/\s/.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`"${text}" is not a web address.`);
    }
    if (url.protocol !== 'https:' && !isLocalHost(url))
      throw new Error('A remote server must use https://. Use http:// only for localhost.');
    return { name, config: { url: text }, secrets: [], oauth: false, label: name };
  }
  const words = splitCommand(text);
  const [command, ...args] = words;
  if (!command) throw new Error('Give a web address or a command.');
  const config: McpServerConfig = { command, ...(args.length && { args }) };
  return { name, config, secrets: [], command: commandLine(config), oauth: false, label: name };
}

/** A name for a custom server from what was typed: the host of a URL, or the last word of the command. */
export function suggestName(input: string, taken: Set<string>): string {
  let base = 'server';
  try {
    if (/^https?:\/\//i.test(input.trim())) {
      base = new URL(input.trim()).hostname.replace(/^(www|mcp|api)\./, '').split('.')[0] ?? base;
    } else {
      const last =
        splitCommand(input)
          .filter((w) => !w.startsWith('-'))
          .pop() ?? base;
      base =
        last
          .split('/')
          .pop()
          ?.replace(/^(server-|mcp-server-|@)/, '') ?? base;
    }
  } catch {
    // keep the default
  }
  base =
    base
      .replace(/[^A-Za-z0-9_.-]/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '')
      .slice(0, 30) || 'server';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

/**
 * Stores the secrets and saves the server. Nothing is written unless every secret has a value.
 * Returns where each secret went, for one line of output.
 */
export function applyPlan(
  plan: ConnectPlan,
  deps: { home: string; secrets: SecretStore; values: Record<string, string> },
): string[] {
  for (const s of plan.secrets)
    if (!deps.values[s.key]?.trim()) throw new Error(`No ${s.label} was given. Nothing was added.`);
  const saved = loadSaved(deps.home);
  if (plan.name in saved.mcpServers)
    throw new Error(`There is already a server named ${plan.name}.`);
  const where: string[] = [];
  for (const s of plan.secrets) {
    const store = deps.secrets.set(`${plan.name}.${s.key}`, (deps.values[s.key] as string).trim());
    where.push(
      `${s.key} in ${store === 'keychain' ? 'the macOS Keychain' : 'REMY_HOME (private file)'}`,
    );
  }
  saveSaved(deps.home, { ...saved, mcpServers: { ...saved.mcpServers, [plan.name]: plan.config } });
  return where;
}

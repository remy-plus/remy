// Which MCP servers Remy knows about and how their secrets are filled in.
//
// Two sources, merged by name: `mcpServers` in remy.config.json (edited by hand) and
// REMY_HOME/connections.json (written by `remy connect` and the /connections panel).
// A config-file entry replaces a saved one with the same name. The saved file also keeps the
// names the user switched off, which applies to both sources, so a hand-written entry can be
// disabled without editing the file.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStdio, type McpServerConfig, mcpServersSchema } from '@remy/mcp';
import { forgetOAuth } from './mcp-oauth.ts';
import type { SecretStore } from './mcp-secrets.ts';

export type ServerSource = 'config' | 'saved';

export interface DeclaredServer {
  name: string;
  config: McpServerConfig;
  source: ServerSource;
  /** Switched off in the saved file or with `enabled: false`. */
  disabled: boolean;
}

export interface SavedConnections {
  mcpServers: Record<string, McpServerConfig>;
  /** Server names the user switched off. */
  disabled: string[];
}

const fileOf = (home: string) => join(home, 'connections.json');

/** Reads connections.json. A damaged file is an error with the fix, never silently empty. */
export function loadSaved(home: string): SavedConnections {
  const path = fileOf(home);
  if (!existsSync(path)) return { mcpServers: {}, disabled: [] };
  let raw: { mcpServers?: unknown; disabled?: unknown };
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(
      `Could not read ${path}: ${(e as Error).message}. Fix or delete the file, then try again.`,
    );
  }
  const parsed = mcpServersSchema.safeParse(raw.mcpServers ?? {});
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues[0]?.message ?? 'a server entry is not valid'}. Fix the entry or remove it with remy connect remove <name>.`,
    );
  const disabled = Array.isArray(raw.disabled)
    ? raw.disabled.filter((n): n is string => typeof n === 'string')
    : [];
  return { mcpServers: parsed.data, disabled };
}

/** Writes connections.json privately (0600): it names commands that run and secret references. */
export function saveSaved(home: string, data: SavedConnections): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = fileOf(home);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Saved servers first, then the config file's, which win on a shared name. Order is kept. */
export function mergeServers(
  saved: SavedConnections,
  fromConfig: Record<string, McpServerConfig> = {},
): DeclaredServer[] {
  const byName = new Map<string, DeclaredServer>();
  const add = (entries: Record<string, McpServerConfig>, source: ServerSource) => {
    for (const [name, config] of Object.entries(entries))
      byName.set(name, {
        name,
        config,
        source,
        disabled: config.enabled === false || saved.disabled.includes(name),
      });
  };
  add(saved.mcpServers, 'saved');
  add(fromConfig, 'config');
  return [...byName.values()];
}

const REF = /\$\{secret:([A-Za-z0-9_.-]+)\}/g;

/** The secret names a value refers to. */
export const secretRefs = (value: string): string[] =>
  [...value.matchAll(REF)].map((m) => m[1] as string);

/** Every secret a server's env and headers refer to. */
export function serverSecretRefs(config: McpServerConfig): string[] {
  const values = Object.values((isStdio(config) ? config.env : config.headers) ?? {});
  return [...new Set(values.flatMap(secretRefs))];
}

export interface ResolvedServers {
  /** Enabled servers with their secrets filled in. Only ever handed to the MCP client. */
  servers: Record<string, McpServerConfig>;
  /** Every secret value that was filled in, by secret name: for the redactor. */
  values: Record<string, string>;
  /** Servers left out because a secret they need is not saved. */
  missing: { server: string; secret: string }[];
}

/**
 * Fills "${secret:<name>}" in each enabled server's env or headers, just before the manager is built.
 * A server whose secret is not saved is left out (and reported), not started without it.
 */
export function resolveServers(declared: DeclaredServer[], secrets: SecretStore): ResolvedServers {
  const out: ResolvedServers = { servers: {}, values: {}, missing: [] };
  const fill = (server: string, map: Record<string, string> | undefined) => {
    if (!map) return { ok: true as const, map };
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      let lacking: string | undefined;
      filled[k] = v.replace(REF, (_all, name: string) => {
        const value = secrets.get(name);
        if (value === undefined) {
          lacking ??= name;
          return '';
        }
        out.values[name] = value;
        return value;
      });
      if (lacking) {
        out.missing.push({ server, secret: lacking });
        return { ok: false as const };
      }
    }
    return { ok: true as const, map: filled };
  };
  for (const d of declared) {
    if (d.disabled) continue;
    const c = d.config;
    if (isStdio(c)) {
      const env = fill(d.name, c.env);
      if (env.ok) out.servers[d.name] = { ...c, ...(env.map && { env: env.map }) };
    } else {
      const headers = fill(d.name, c.headers);
      if (headers.ok) out.servers[d.name] = { ...c, ...(headers.map && { headers: headers.map }) };
    }
  }
  return out;
}

/** The exact command line a local server runs, for showing before the user says yes. */
export function commandLine(config: McpServerConfig): string {
  if (!isStdio(config)) return config.url;
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
  return [config.command, ...(config.args ?? [])].map(quote).join(' ');
}

/**
 * Forgets a saved server and the secrets only it used. False when no saved server has that name
 * (a config-file entry is not ours to edit).
 */
export function removeSaved(
  home: string,
  name: string,
  secrets: SecretStore,
  fromConfig: Record<string, McpServerConfig> = {},
): boolean {
  const saved = loadSaved(home);
  const entry = saved.mcpServers[name];
  if (!entry) return false;
  const { [name]: _gone, ...rest } = saved.mcpServers;
  saveSaved(home, { mcpServers: rest, disabled: saved.disabled.filter((n) => n !== name) });
  const stillUsed = new Set(
    mergeServers({ mcpServers: rest, disabled: [] }, fromConfig).flatMap((d) =>
      serverSecretRefs(d.config),
    ),
  );
  for (const ref of serverSecretRefs(entry)) if (!stillUsed.has(ref)) secrets.remove(ref);
  // Its sign-in (tokens and registered client) goes with it.
  forgetOAuth(secrets, name);
  return true;
}

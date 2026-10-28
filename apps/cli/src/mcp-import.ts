// `remy connect --import`: finds the MCP servers a person already set up in Claude Desktop or
// Claude Code. Parsing only; the files are read by the caller, who asks before anything is added.
import { isStdio, type McpServerConfig, mcpServerConfigSchema } from '@remy/mcp';
import { SECRET_NAME } from './mcp-secrets.ts';

export interface ImportSource {
  label: string;
  path: string;
}

export interface FoundServer {
  name: string;
  config: McpServerConfig;
  /** The source's label, such as "Claude Desktop". */
  from: string;
}

export interface SkippedServer {
  name: string;
  from: string;
  why: string;
}

export interface ImportScan {
  found: FoundServer[];
  skipped: SkippedServer[];
}

/** Where other apps keep their servers. `cwd` is the folder Remy was started in. */
export function importSources(homeDir: string, cwd: string, platform: string): ImportSource[] {
  const sep = '/';
  const at = (...p: string[]) => [homeDir, ...p].join(sep);
  const desktop =
    platform === 'darwin'
      ? at('Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : platform === 'win32'
        ? undefined
        : at('.config', 'Claude', 'claude_desktop_config.json');
  return [
    ...(desktop ? [{ label: 'Claude Desktop', path: desktop }] : []),
    { label: 'Claude Code', path: at('.claude.json') },
    { label: 'Claude Code (this folder)', path: [cwd, '.mcp.json'].join(sep) },
  ];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Servers listed in one file's text. `cwd` picks which project's list `.claude.json` contributes. */
export function parseImport(label: string, text: string, cwd: string): ImportScan {
  const scan: ImportScan = { found: [], skipped: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return scan;
  }
  if (!isRecord(raw)) return scan;
  const lists: unknown[] = [raw.mcpServers];
  const project = isRecord(raw.projects) ? raw.projects[cwd] : undefined;
  if (isRecord(project)) lists.push(project.mcpServers);
  for (const list of lists) {
    if (!isRecord(list)) continue;
    for (const [name, entry] of Object.entries(list)) {
      if (isRecord(entry) && entry.type === 'sse') {
        scan.skipped.push({
          name,
          from: label,
          why: 'it uses the older SSE transport, which Remy does not support yet',
        });
        continue;
      }
      const parsed = mcpServerConfigSchema.safeParse(entry);
      if (!parsed.success) {
        scan.skipped.push({ name, from: label, why: 'it has no command or url Remy can use' });
        continue;
      }
      scan.found.push({ name, config: parsed.data, from: label });
    }
  }
  return scan;
}

/** All sources together. A name seen twice keeps the first; the later one is skipped. */
export function mergeScans(scans: ImportScan[]): ImportScan {
  const out: ImportScan = { found: [], skipped: [] };
  const seen = new Set<string>();
  for (const s of scans) {
    out.skipped.push(...s.skipped);
    for (const f of s.found) {
      if (seen.has(f.name))
        out.skipped.push({ name: f.name, from: f.from, why: 'another source already lists it' });
      else {
        seen.add(f.name);
        out.found.push(f);
      }
    }
  }
  return out;
}

const SENSITIVE = /token|key|secret|passw|auth|credential|bearer/i;
const PLACEHOLDER = /^\$\{.*\}$/;

/**
 * Moves values that look like credentials out of a server's env or headers, leaving
 * "${secret:<server>.<KEY>}" in their place. Returns the new config and the values to store.
 */
export function secretize(
  name: string,
  config: McpServerConfig,
): { config: McpServerConfig; secrets: Record<string, string> } {
  const secrets: Record<string, string> = {};
  const swap = (map: Record<string, string> | undefined) => {
    if (!map) return map;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      const id = `${name}.${k}`.replace(/[^A-Za-z0-9_.-]/g, '_');
      if (v && SENSITIVE.test(k) && !PLACEHOLDER.test(v) && SECRET_NAME.test(id)) {
        secrets[id] = v;
        out[k] = `\${secret:${id}}`;
      } else out[k] = v;
    }
    return out;
  };
  if (isStdio(config)) {
    const env = swap(config.env);
    return { config: { ...config, ...(env && { env }) }, secrets };
  }
  const headers = swap(config.headers);
  return { config: { ...config, ...(headers && { headers }) }, secrets };
}

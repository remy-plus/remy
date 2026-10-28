import type { Tool } from '@remy/core';
import type { McpServerConfig } from './config.ts';
import { McpConnection, type McpConnectionOptions } from './connection.ts';
import { toTools } from './tools.ts';

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface McpLoadResult {
  tools: Tool[];
  /** Servers that could not be reached or listed. The rest still load. */
  errors: { server: string; error: string }[];
}

/** All configured servers: one lazy connection each, one place to shut them down. */
export class McpManager {
  readonly #connections = new Map<string, McpConnection>();
  readonly #configs: Record<string, McpServerConfig>;
  readonly #opts: (name: string) => McpConnectionOptions;

  constructor(
    servers: Record<string, McpServerConfig>,
    opts: (name: string) => McpConnectionOptions = () => ({}),
  ) {
    this.#configs = servers;
    this.#opts = opts;
  }

  /** The connection for a server, created (not connected) on first ask. */
  connection(name: string): McpConnection {
    let conn = this.#connections.get(name);
    if (!conn) {
      const config = this.#configs[name];
      if (!config) throw new Error(`no MCP server named "${name}"`);
      conn = new McpConnection(name, config, this.#opts(name));
      this.#connections.set(name, conn);
    }
    return conn;
  }

  status(): McpServerStatus[] {
    return Object.entries(this.#configs).map(([name, c]) => ({
      name,
      enabled: c.enabled !== false,
      connected: this.#connections.get(name)?.connected ?? false,
    }));
  }

  /** Connects every enabled server (in parallel), lists its tools and wraps them. */
  async loadTools(signal?: AbortSignal): Promise<McpLoadResult> {
    const names = Object.entries(this.#configs)
      .filter(([, c]) => c.enabled !== false)
      .map(([name]) => name);
    const listings = await Promise.all(
      names.map(async (server) => {
        try {
          const conn = this.connection(server);
          return { server, listed: await conn.listTools(signal) };
        } catch (e) {
          return { server, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    const result: McpLoadResult = { tools: [], errors: [] };
    // Wrapped in config order, sharing one name set, so names are stable and unique across servers.
    const taken = new Set<string>();
    for (const l of listings) {
      if (l.listed === undefined) {
        result.errors.push({ server: l.server, error: l.error ?? 'unknown error' });
        continue;
      }
      const config = this.#configs[l.server] as McpServerConfig;
      result.tools.push(...toTools(l.server, this.connection(l.server), l.listed, config, taken));
    }
    return result;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#connections.values()].map((c) => c.close()));
  }
}

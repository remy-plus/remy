import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CallToolResult,
  ErrorCode,
  McpError,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { isStdio, type McpServerConfig } from './config.ts';

export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 30_000;
/** A server that keeps returning cursors forever must not hang listing. */
const MAX_LIST_PAGES = 50;
const STDERR_TAIL_CHARS = 2_000;

/** What a call to a server came back with. Failures say how far the call got, so recovery never guesses. */
export type McpCallOutcome =
  | { ok: true; result: CallToolResult }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      phase: 'before_effect' | 'after_effect' | 'unknown';
    };

/** The slice of a connection that wrapped tools need. */
export interface McpCaller {
  callTool(
    name: string,
    args: unknown,
    opts: { signal: AbortSignal; timeoutMs: number },
  ): Promise<McpCallOutcome>;
}

export interface McpConnectionOptions {
  /** Replaces the stdio / HTTP transport. Called again on every (re)connect. Used by tests. */
  createTransport?: () => Transport | Promise<Transport>;
  clientVersion?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One MCP server. Connects on first use and reconnects on the next use if the server went away.
 * Never throws from `callTool`; `listTools` and `connect` throw.
 */
export class McpConnection implements McpCaller {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly #opts: McpConnectionOptions;
  #client: Client | undefined;
  #connecting: Promise<Client> | undefined;
  #closed = false;
  #stderr = '';

  constructor(name: string, config: McpServerConfig, opts: McpConnectionOptions = {}) {
    this.name = name;
    this.config = config;
    this.#opts = opts;
  }

  get connected(): boolean {
    return this.#client !== undefined;
  }

  /** The end of what a local server printed to stderr. Shown when it fails to start; may be empty. */
  get stderrTail(): string {
    return this.#stderr;
  }

  async connect(signal?: AbortSignal): Promise<Client> {
    if (this.#closed) throw new Error(`MCP server "${this.name}" is closed`);
    if (this.#client) return this.#client;
    this.#connecting ??= this.#open(signal).finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  async #open(signal?: AbortSignal): Promise<Client> {
    const transport = await this.#transport();
    const client = new Client({ name: 'remy', version: this.#opts.clientVersion ?? '0.0.0' });
    client.onclose = () => {
      if (this.#client === client) this.#client = undefined;
    };
    // Transport errors surface through the pending request or `onclose`; nothing to add here.
    client.onerror = () => {};
    try {
      await client.connect(transport, {
        timeout: CONNECT_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      await client.close().catch(() => {});
      throw new Error(`could not connect to MCP server "${this.name}": ${message(e)}`);
    }
    if (this.#closed) {
      await client.close().catch(() => {});
      throw new Error(`MCP server "${this.name}" is closed`);
    }
    this.#client = client;
    return client;
  }

  async #transport(): Promise<Transport> {
    if (this.#opts.createTransport) return this.#opts.createTransport();
    const c = this.config;
    if (isStdio(c)) {
      const t = new StdioClientTransport({
        command: c.command,
        ...(c.args ? { args: c.args } : {}),
        ...(c.cwd ? { cwd: c.cwd } : {}),
        // Only a safe default set of variables is inherited; the config adds the rest.
        env: { ...getDefaultEnvironment(), ...c.env },
        // 'inherit' would paint a server's logs over the full-screen UI.
        stderr: 'pipe',
      });
      t.stderr?.on('data', (chunk: Buffer) => {
        this.#stderr = (this.#stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
      });
      return t;
    }
    return new StreamableHTTPClientTransport(new URL(c.url), {
      ...(c.headers ? { requestInit: { headers: c.headers } } : {}),
    });
  }

  /** Every tool the server offers, following pagination. */
  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const client = await this.connect(signal);
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const res = await client.listTools(cursor ? { cursor } : {}, {
        timeout: LIST_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      tools.push(...res.tools);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(
    name: string,
    args: unknown,
    opts: { signal: AbortSignal; timeoutMs: number },
  ): Promise<McpCallOutcome> {
    const { signal, timeoutMs } = opts;
    if (signal.aborted) {
      return { ok: false, error: 'cancelled', retryable: false, phase: 'before_effect' };
    }
    let client: Client;
    try {
      client = await this.connect(signal);
    } catch (e) {
      // Nothing was sent, so nothing happened.
      return { ok: false, error: message(e), retryable: true, phase: 'before_effect' };
    }
    try {
      const result = (await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { signal, timeout: timeoutMs },
      )) as CallToolResult;
      return { ok: true, result };
    } catch (e) {
      // The server answered with a protocol error for the request itself: it did not run the tool.
      if (
        e instanceof McpError &&
        (e.code === ErrorCode.InvalidParams || e.code === ErrorCode.MethodNotFound)
      ) {
        return { ok: false, error: message(e), retryable: false, phase: 'before_effect' };
      }
      // A crash, a closed pipe, a timeout or an abort after sending: the effect may have happened.
      const closed = e instanceof McpError && e.code === ErrorCode.ConnectionClosed;
      if (closed && this.#client === client) this.#client = undefined;
      const why = signal.aborted ? 'cancelled' : message(e);
      return {
        ok: false,
        error: `${why} (the result of "${name}" on "${this.name}" is unknown)`,
        retryable: false,
        phase: 'unknown',
      };
    }
  }

  /** Stops the server. Safe to call twice; the connection cannot be used afterwards. */
  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#client ?? (await this.#connecting?.catch(() => undefined));
    this.#client = undefined;
    await client?.close().catch(() => {});
  }
}

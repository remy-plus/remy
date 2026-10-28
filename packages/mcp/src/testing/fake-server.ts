// An in-process MCP server for tests. Not part of the build.

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpConnectionOptions } from '../connection.ts';

export type FakeHandler = (
  name: string,
  args: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => CallToolResult | Promise<CallToolResult>;

export interface FakeServer {
  /** Pass as `createTransport`; every call starts a fresh server session. */
  options: McpConnectionOptions;
  /** Closes the server side of the live session (a "crash"). */
  crash(): Promise<void>;
  connects: number;
  calls: { name: string; args: Record<string, unknown> }[];
}

/** `pageSize` splits the listing into cursor pages. */
export function fakeServer(
  tools: Tool[],
  handler: FakeHandler,
  opts: { pageSize?: number } = {},
): FakeServer {
  let live: Server | undefined;
  const fake: FakeServer = {
    connects: 0,
    calls: [],
    async crash() {
      await live?.close();
    },
    options: {
      async createTransport() {
        fake.connects++;
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const server = new Server(
          { name: 'fake', version: '1.0.0' },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async (req) => {
          const size = opts.pageSize ?? tools.length;
          const start = Number(req.params?.cursor ?? 0);
          const next = start + size;
          return {
            tools: tools.slice(start, next),
            ...(next < tools.length ? { nextCursor: String(next) } : {}),
          };
        });
        server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
          const args = (req.params.arguments ?? {}) as Record<string, unknown>;
          fake.calls.push({ name: req.params.name, args });
          return handler(req.params.name, args, { signal: extra.signal });
        });
        live = server;
        await server.connect(serverSide);
        return clientSide;
      },
    },
  };
  return fake;
}

export const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });

export const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  inputSchema: { type: 'object', properties: {} },
  ...extra,
});

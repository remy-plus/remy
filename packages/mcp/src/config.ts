import { type Effect, RISKS, type Risk } from '@remy/core';
import { z } from 'zod';

/** Per-tool overrides win over the hints a server reports. `reconcilable` needs a `reconcile()` an MCP tool cannot have. */
export type McpEffectOverride = Exclude<Effect, 'reconcilable'>;

export interface McpToolOverride {
  risk?: Risk | undefined;
  effect?: McpEffectOverride | undefined;
  /** Leave this tool out entirely. */
  disabled?: boolean | undefined;
}

interface McpServerCommon {
  /**
   * Believe the server's `readOnlyHint` (a read-only tool then runs as `read` + `none`).
   * Off unless the config says so: hints are the server's claim, not something Remy checked.
   */
  trustHints?: boolean | undefined;
  tools?: Record<string, McpToolOverride> | undefined;
  /** `false` keeps the entry in the config but never connects. */
  enabled?: boolean | undefined;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number | undefined;
}

export interface McpStdioConfig extends McpServerCommon {
  command: string;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
}

export interface McpHttpConfig extends McpServerCommon {
  url: string;
  headers?: Record<string, string> | undefined;
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig;

export const isStdio = (c: McpServerConfig): c is McpStdioConfig => 'command' in c;

const toolOverride = z.object({
  risk: z.enum(RISKS as [Risk, ...Risk[]]).optional(),
  effect: z.enum(['none', 'idempotent', 'unsafe_to_retry']).optional(),
  disabled: z.boolean().optional(),
});

const common = {
  trustHints: z.boolean().optional(),
  tools: z.record(z.string(), toolOverride).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(30 * 60_000)
    .optional(),
};

const EITHER = 'give either command or url, not both';

// Unknown keys (Claude Desktop's `type`, for one) are ignored so pasted configs load.
const stdio = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
  url: z.never({ error: EITHER }).optional(),
  ...common,
});

const http = z.object({
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).optional(),
  command: z.never({ error: EITHER }).optional(),
  ...common,
});

/** One entry of `mcpServers`: a local process (`command`) or a remote endpoint (`url`). */
export const mcpServerConfigSchema = z.union([stdio, http], {
  error: 'an MCP server needs either a command (local) or a url (remote)',
}) as unknown as z.ZodType<McpServerConfig, unknown>;

export const mcpServersSchema = z.record(z.string().min(1), mcpServerConfigSchema);

import { createHash } from 'node:crypto';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { Effect, Tool as RemyTool, Risk, ToolResult } from '@remy/core';
import { z } from 'zod';
import type { McpServerConfig } from './config.ts';
import { DEFAULT_CALL_TIMEOUT_MS, type McpCaller } from './connection.ts';

/** The tool name is the model API's limit; the registry also requires lowercase letters, digits and `_`. */
const MAX_NAME = 64;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_PREVIEW_CHARS = 140;

// ---------- Names ----------
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 6);

/**
 * `<server>__<tool>` restricted to `[a-z][a-z0-9_]{0,63}`. Distinct inputs that sanitize to the same
 * name are told apart by `toTools`; a name that is too long keeps its start and gets a hash of the original.
 */
export function mcpToolName(server: string, tool: string): string {
  let s = slug(server) || 'mcp';
  if (!/^[a-z]/.test(s)) s = `s_${s}`;
  const t = slug(tool) || 'tool';
  const name = `${s}__${t}`;
  if (name.length <= MAX_NAME) return name;
  const suffix = `_${shortHash(`${server}\0${tool}`)}`;
  return name.slice(0, MAX_NAME - suffix.length).replace(/_+$/, '') + suffix;
}

// ---------- Classification ----------
export interface McpToolHints {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
}

/**
 * Risk and effect for an MCP tool. Without trusted hints a server's tool could do anything as the user
 * and a retry could repeat it, so the default is `send_as_user` + `unsafe_to_retry`.
 * - `readOnlyHint: true` lowers it to `read` + `none`, only when the config sets `trustHints`.
 * - `destructiveHint: true` raises it to `irreversible`. Raising is always safe, so it needs no trust,
 *   and it beats `readOnlyHint` when a server claims both.
 * - A per-tool override in the config wins over all of it.
 */
export function classifyMcpTool(
  hints: McpToolHints | undefined,
  config: Pick<McpServerConfig, 'trustHints'> & { tools?: McpServerConfig['tools'] },
  toolName: string,
): { risk: Risk; effect: Effect } {
  let risk: Risk = 'send_as_user';
  let effect: Effect = 'unsafe_to_retry';
  if (hints?.destructiveHint === true) {
    risk = 'irreversible';
  } else if (hints?.readOnlyHint === true && config.trustHints === true) {
    risk = 'read';
    effect = 'none';
  }
  const o = config.tools?.[toolName];
  return { risk: o?.risk ?? risk, effect: o?.effect ?? effect };
}

// ---------- Arguments ----------
type Schema = Record<string, unknown>;

/**
 * Zod for a tool's JSON Schema, so bad arguments are caught before the call. Falls back to any object
 * (the server validates) when the schema uses something the converter does not know. Either way the
 * model is shown the server's own `properties` and `required`.
 */
export function argsSchema(inputSchema: McpTool['inputSchema'] | undefined): z.ZodType<unknown> {
  const schema = (inputSchema ?? { type: 'object' }) as Schema;
  const shown = {
    ...(schema.properties ? { properties: schema.properties } : {}),
    ...(schema.required ? { required: schema.required } : {}),
  };
  try {
    const converted = z.fromJSONSchema(schema as never);
    // Prove that it round-trips; a schema that converts but cannot be described to the model is no use.
    z.toJSONSchema(converted);
    return converted;
  } catch {
    return z.looseObject({}).meta(shown) as z.ZodType<unknown>;
  }
}

// ---------- Output ----------
const kb = (base64: string) => Math.max(1, Math.round((base64.length * 0.75) / 1024));

interface Block {
  type: string;
  [k: string]: unknown;
}

function describeBlock(b: Block): string {
  switch (b.type) {
    case 'text':
      return String(b.text ?? '');
    case 'image':
    case 'audio':
      return `[${b.type} ${kb(String(b.data ?? ''))} KB]`;
    case 'resource': {
      const r = (b.resource ?? {}) as { uri?: string; text?: string; blob?: string };
      if (typeof r.text === 'string') return r.text;
      return `[resource ${r.uri ?? ''}${r.blob ? ` ${kb(r.blob)} KB` : ''}]`;
    }
    case 'resource_link':
      return `[link ${String(b.name ?? '')} ${String(b.uri ?? '')}]`.replace(/ +/g, ' ');
    default:
      return `[${b.type} content]`;
  }
}

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n… ${text.length - max} more characters not shown`;
}

function renderResult(result: {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean | undefined;
}): string {
  const blocks = Array.isArray(result.content) ? (result.content as Block[]) : [];
  let text = blocks.map(describeBlock).join('\n').trim();
  if (!text && result.structuredContent !== undefined) {
    text = JSON.stringify(result.structuredContent);
  }
  return text;
}

const compactArgs = (args: unknown): string => {
  const s = JSON.stringify(args ?? {}) ?? '{}';
  return s === '{}' ? '' : s;
};

// ---------- Tools ----------
/**
 * Wraps a server's tools as Remy tools named `<server>__<tool>`. Tools the config disables are left out.
 * Names are made unique deterministically (tools are visited in name order, a clash gets a hash suffix).
 * Pass one `taken` set across servers so names stay unique among all of them.
 */
export function toTools(
  serverName: string,
  conn: McpCaller,
  listed: readonly McpTool[],
  config: McpServerConfig,
  taken: Set<string> = new Set(),
): RemyTool[] {
  const tools: RemyTool[] = [];
  const sorted = [...listed].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const t of sorted) {
    if (config.tools?.[t.name]?.disabled === true) continue;
    let name = mcpToolName(serverName, t.name);
    for (let n = 0; taken.has(name); n++) {
      const suffix = `_${shortHash(`${serverName}\0${t.name}\0${n}`)}`;
      name = mcpToolName(serverName, t.name).slice(0, MAX_NAME - suffix.length) + suffix;
    }
    taken.add(name);
    const { risk, effect } = classifyMcpTool(t.annotations, config, t.name);
    const timeoutMs = config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    const about = (t.description ?? t.title ?? t.annotations?.title ?? t.name).trim();
    tools.push({
      name,
      description: capText(`${about} (via ${serverName})`, MAX_DESCRIPTION_CHARS),
      args: argsSchema(t.inputSchema),
      selectable: true,
      risk,
      effect,
      outputTrust: 'untrusted',
      timeoutMs,
      maxOutputChars: MAX_OUTPUT_CHARS,
      preview: (args) => {
        const line = `${serverName}: ${t.name} ${compactArgs(args)}`.trim();
        return line.length > MAX_PREVIEW_CHARS ? `${line.slice(0, MAX_PREVIEW_CHARS - 1)}…` : line;
      },
      async execute(args, ctx): Promise<ToolResult> {
        const out = await conn.callTool(t.name, args, { signal: ctx.signal, timeoutMs });
        if (!out.ok) return out;
        const text = capText(renderResult(out.result), MAX_OUTPUT_CHARS);
        if (out.result.isError === true) {
          // The server ran the tool and said it failed. What it did first is unknown, so never retry.
          return {
            ok: false,
            error: text || `${t.name} failed without a message`,
            retryable: false,
            phase: 'unknown',
          };
        }
        return { ok: true, content: text || '(no output)', trust: 'untrusted' };
      },
    });
  }
  return tools;
}

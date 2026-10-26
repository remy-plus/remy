import {
  type Message,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
  type ToolSpec,
} from '@remy/core';
import { addUsage, MAX_REPAIRS } from './native.ts';
import type { RawRequest } from './types.ts';

function toolPrompt(tools: ToolSpec[]): string {
  const list = tools
    .map(
      (t) => `- ${t.name}: ${t.description}\n  args JSON schema: ${JSON.stringify(t.parameters)}`,
    )
    .join('\n');
  return [
    'You act by calling tools. Available tools:',
    list,
    '',
    'Reply with exactly one JSON object and nothing else, in this form:',
    '{"tool": "<tool name>", "args": {<arguments matching the tool schema>}}',
  ].join('\n');
}

function toWire(messages: Message[]): Message[] {
  return messages.map((m): Message => {
    if (m.role === 'tool')
      return { role: 'user', content: `Result of ${m.tool} (${m.callId}): ${m.content}` };
    if (m.role === 'assistant' && m.calls?.length) {
      const c = m.calls[0];
      const json = JSON.stringify({ tool: c?.tool, args: c?.args ?? {} });
      return { role: 'assistant', content: m.content ? `${m.content}\n${json}` : json };
    }
    return m;
  });
}

/** Every top-level balanced `{...}` span in text, string-aware. */
function objectSpans(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') j++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        out.push(text.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return out;
}

/** Pulls the tool-call object out of a reply, tolerating prose and code fences. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {}
  const candidates = [
    ...[...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1] ?? ''),
    t,
  ];
  let first: unknown;
  for (const c of candidates) {
    for (const span of [c.trim(), ...objectSpans(c)]) {
      try {
        const v = JSON.parse(span);
        if (v && typeof v === 'object' && 'tool' in v) return v;
        first ??= v;
      } catch {}
    }
  }
  if (first !== undefined) return first;
  throw new Error('no JSON object found in the reply');
}

function parseCall(text: string, known: Set<string>): { tool: string; args: unknown } {
  let v: unknown;
  try {
    v = extractJson(text);
  } catch (e) {
    throw new Error(`${(e as Error).message}. Reply with exactly one JSON object.`);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('the reply must be a JSON object {"tool": ..., "args": {...}}');
  const o = v as Record<string, unknown>;
  if (typeof o.tool !== 'string') throw new Error('missing string field "tool"');
  if (!known.has(o.tool))
    throw new Error(`unknown tool "${o.tool}". Available tools: ${[...known].join(', ')}`);
  if (typeof o.args !== 'object' || o.args === null || Array.isArray(o.args))
    throw new Error('field "args" must be a JSON object');
  return { tool: o.tool, args: o.args };
}

/** Tool calling for weak models: tools in the system prompt, one JSON object per reply. */
export function withJsonTools(raw: ModelClient): ModelClient {
  return {
    id: raw.id,
    caps: raw.caps,
    // The reply is a JSON tool call, not prose, so nothing streams while tools are in play.
    async complete(
      req: ModelRequest,
      signal: AbortSignal,
      onText?: (delta: string) => void,
    ): Promise<ModelResponse> {
      if (!req.tools.length) return raw.complete(req, signal, onText);
      const known = new Set(req.tools.map((t) => t.name));
      const responseFormat: Record<string, unknown> = raw.caps.jsonSchema
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'tool_call',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  tool: { type: 'string', enum: [...known] },
                  args: { type: 'object' },
                },
                required: ['tool', 'args'],
              },
            },
          }
        : { type: 'json_object' };
      const messages = toWire(req.messages);
      let usage = { inTokens: 0, outTokens: 0 };
      for (let attempt = 0; ; attempt++) {
        const wire: RawRequest = {
          ...req,
          system: `${req.system}\n\n${toolPrompt(req.tools)}`,
          messages,
          tools: [],
          responseFormat,
        };
        const res = await raw.complete(wire, signal);
        usage = addUsage(usage, res.usage);
        const text = res.text ?? '';
        try {
          return { calls: [parseCall(text, known)], usage };
        } catch (e) {
          const msg = (e as Error).message;
          if (attempt >= MAX_REPAIRS)
            throw new ModelError(`no valid tool call after ${MAX_REPAIRS} retries: ${msg}`, false);
          messages.push(
            { role: 'assistant', content: text },
            {
              role: 'user',
              content: `Invalid reply: ${msg}. Reply again with exactly one JSON object.`,
            },
          );
        }
      }
    },
  };
}

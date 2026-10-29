import {
  type Message,
  type ModelCaps,
  type ModelClient,
  ModelError,
  type ModelResponse,
} from '@remy/core';
import type { RawRequest } from './types.ts';

export interface OpenAIClientOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  caps: ModelCaps;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** How hard a reasoning model thinks per step. Default `low`: medium made GPT-5 nano take 10–30 s a step. */
  reasoningEffort?: ReasoningEffort;
}

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';

type Json = Record<string, unknown>;

/** OpenAI reasoning models (gpt-5*, o1/o3/o4*, optionally `openai/`-prefixed) reject `max_tokens` and custom temperatures. */
const REASONING_MODEL = /^(?:openai\/)?(?:gpt-5|o[134])(?![a-z0-9])/i;
export const isReasoningModel = (id: string): boolean => REASONING_MODEL.test(id);
/** Reasoning tokens count against the output limit, so reasoning models get at least this many. */
export const REASONING_MIN_OUTPUT_TOKENS = 8192;

export function toOpenAIMessages(system: string, messages: Message[]): Json[] {
  const out: Json[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'tool')
      out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
    else {
      const msg: Json = { role: 'assistant', content: m.content ?? null };
      if (m.calls?.length)
        msg.tool_calls = m.calls.map((c) => ({
          id: c.callId,
          type: 'function',
          function: { name: c.tool, arguments: JSON.stringify(c.args ?? {}) },
        }));
      out.push(msg);
    }
  }
  return out;
}

/** Claude through OpenRouter: Anthropic caches only up to explicit breakpoints. */
const ANTHROPIC_VIA_ROUTER = /^anthropic\//;

/**
 * Prompt-cache breakpoints for Claude on OpenRouter: after the system prompt and on the last
 * message, as `cache_control` on a text part (the form OpenRouter passes on to Anthropic).
 */
export function withRouterCacheBreaks(messages: Json[]): Json[] {
  const last = messages.length - 1;
  return messages.map((m, i) => {
    const mark = (i === 0 && m.role === 'system') || i === last;
    if (!mark || typeof m.content !== 'string' || !m.content) return m;
    return {
      ...m,
      content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
    };
  });
}

interface Reply {
  text: string;
  calls: { name: string; args: string }[];
  finishReason: unknown;
  usage: Json;
}

/**
 * Reasoning text in a streamed delta, for the providers that send it: `reasoning_content`
 * (DeepSeek, vLLM), `reasoning` (OpenRouter, Ollama) and `reasoning_details` summary or text items.
 */
export function reasoningDeltas(delta: Json): string[] {
  const out: string[] = [];
  for (const key of ['reasoning_content', 'reasoning'])
    if (typeof delta[key] === 'string' && delta[key]) return [delta[key] as string];
  if (Array.isArray(delta.reasoning_details))
    for (const d of delta.reasoning_details as Json[]) {
      const t =
        typeof d.summary === 'string' ? d.summary : typeof d.text === 'string' ? d.text : '';
      if (t) out.push(t);
    }
  return out;
}

/** Reads a chat-completions SSE stream into the same shape as a full response, forwarding text deltas. */
async function readStream(
  res: Response,
  onText: (delta: string) => void,
  onReasoning: ((delta: string) => void) | undefined,
  signal: AbortSignal,
  timeout: AbortSignal,
  timeoutMs: number,
): Promise<Reply> {
  const reply: Reply = { text: '', calls: [], finishReason: undefined, usage: {} };
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk: Json;
    try {
      chunk = JSON.parse(payload) as Json;
    } catch {
      throw new ModelError('invalid JSON in response stream', true);
    }
    if (chunk.error) throw new ModelError(`stream error: ${JSON.stringify(chunk.error)}`, true);
    if (chunk.usage) reply.usage = chunk.usage as Json;
    const choice = (chunk.choices as Json[] | undefined)?.[0];
    if (!choice) return;
    if (choice.finish_reason) reply.finishReason = choice.finish_reason;
    const delta = (choice.delta ?? {}) as Json;
    if (typeof delta.content === 'string' && delta.content) {
      reply.text += delta.content;
      onText(delta.content);
    }
    if (onReasoning) for (const r of reasoningDeltas(delta)) onReasoning(r);
    for (const c of (delta.tool_calls as Json[] | undefined) ?? []) {
      const i = Number(c.index ?? 0);
      const call = reply.calls[i] ?? { name: '', args: '' };
      reply.calls[i] = call;
      const fn = (c.function ?? {}) as Json;
      if (typeof fn.name === 'string') call.name += fn.name;
      if (typeof fn.arguments === 'string') call.args += fn.arguments;
    }
  };

  if (!res.body) throw new ModelError('response has no body', true);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handle(line.trimEnd());
    }
    handle((buffer + decoder.decode()).trimEnd());
  } catch (e) {
    if (e instanceof ModelError) throw e;
    if (signal.aborted) throw new ModelError('request aborted', false);
    if (timeout.aborted) throw new ModelError(`timed out after ${timeoutMs}ms`, true);
    throw new ModelError(`network error: ${(e as Error).message}`, true);
  }
  reply.calls = reply.calls.filter(Boolean);
  return reply;
}

/**
 * Raw client. A tool call whose arguments are not valid JSON comes back with
 * `args` set to the raw string, which the tool strategies treat as an error.
 */
export function createOpenAIClient(opts: OpenAIClientOptions): ModelClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    id: opts.id,
    caps: opts.caps,
    async complete(
      req: RawRequest,
      signal: AbortSignal,
      onText?: (delta: string) => void,
      onReasoning?: (delta: string) => void,
    ): Promise<ModelResponse> {
      const messages = toOpenAIMessages(req.system, req.messages);
      const body: Json = {
        model: opts.id,
        messages: ANTHROPIC_VIA_ROUTER.test(opts.id) ? withRouterCacheBreaks(messages) : messages,
      };
      const reasoning = isReasoningModel(opts.id);
      const maxTokens = reasoning
        ? Math.max(req.maxOutputTokens, REASONING_MIN_OUTPUT_TOKENS)
        : req.maxOutputTokens;
      if (reasoning) {
        body.max_completion_tokens = maxTokens;
        const effort = opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
        // OpenRouter takes a `reasoning` object; OpenAI and compatible servers take `reasoning_effort`.
        if (/openrouter\.ai/i.test(opts.baseUrl)) body.reasoning = { effort };
        else body.reasoning_effort = effort;
      } else {
        body.max_tokens = maxTokens;
        body.temperature = req.temperature;
      }
      if (req.tools.length)
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      if (req.responseFormat) body.response_format = req.responseFormat;
      if (onText || onReasoning) {
        body.stream = true;
        body.stream_options = { include_usage: true };
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...opts.headers,
      };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, timeout]),
        });
      } catch (e) {
        if (signal.aborted) throw new ModelError('request aborted', false);
        if (timeout.aborted) throw new ModelError(`timed out after ${timeoutMs}ms`, true);
        throw new ModelError(`network error: ${(e as Error).message}`, true);
      }

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 500);
        throw httpError(res.status, detail, res.headers);
      }

      let reply: Reply;
      if (onText || onReasoning)
        reply = await readStream(
          res,
          onText ?? (() => {}),
          onReasoning,
          signal,
          timeout,
          timeoutMs,
        );
      else {
        let data: Json;
        try {
          data = (await res.json()) as Json;
        } catch {
          throw new ModelError('invalid JSON in response body', true);
        }
        const choice = (data.choices as Json[] | undefined)?.[0];
        const message = choice?.message as Json | undefined;
        if (!message) throw new ModelError('response has no choices', true);
        reply = {
          text: typeof message.content === 'string' ? message.content : '',
          calls: ((message.tool_calls as Json[] | undefined) ?? []).map((c) => {
            const fn = (c.function ?? {}) as Json;
            return {
              name: String(fn.name ?? ''),
              args: typeof fn.arguments === 'string' ? fn.arguments : '',
            };
          }),
          finishReason: choice?.finish_reason,
          usage: (data.usage ?? {}) as Json,
        };
      }
      const calls = reply.calls.map((c) => {
        let args: unknown;
        try {
          args = c.args.trim() ? JSON.parse(c.args) : {};
        } catch {
          args = c.args;
        }
        return { tool: c.name, args };
      });
      const usage = reply.usage;
      const text = reply.text || undefined;
      if (!text?.trim() && calls.length === 0 && reply.finishReason === 'length')
        throw new ModelError(
          `the reply hit the ${maxTokens}-token output limit before producing anything`,
          true,
        );
      return {
        ...(text !== undefined && { text }),
        calls,
        usage: {
          inTokens: Number(usage.prompt_tokens ?? 0),
          outTokens: Number(usage.completion_tokens ?? 0),
          ...cachedTokens(usage),
        },
      };
    },
  };
}

/**
 * Input tokens served from the provider's prompt cache: `prompt_tokens_details.cached_tokens`
 * (OpenAI, OpenRouter, Groq, vLLM) or `prompt_cache_hit_tokens` (DeepSeek). Empty when not reported.
 */
export function cachedTokens(usage: Json): { cachedInTokens?: number } {
  const details = usage.prompt_tokens_details as Json | undefined;
  const n = Number(details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0);
  return Number.isFinite(n) && n > 0 ? { cachedInTokens: n } : {};
}

/**
 * The wait a rate-limited reply asks for: `Retry-After` (seconds or a date), else an
 * `X-RateLimit-Reset` time (epoch seconds or milliseconds). Undefined when it says nothing.
 */
export function retryAfterMs(headers: Headers, now: number): number | undefined {
  const after = headers.get('retry-after');
  if (after) {
    const secs = Number(after);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(after) - now;
    if (Number.isFinite(ms)) return Math.max(0, ms);
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (reset > 0) return Math.max(0, (reset < 1e12 ? reset * 1000 : reset) - now);
  return undefined;
}

/** True when a provider's error body says this one request is over its limit (not just that the key is busy). */
export function requestTooLarge(status: number, detail: string): boolean {
  if (status === 413 || /context_length_exceeded|maximum context length/i.test(detail)) return true;
  if (status !== 429) return false;
  const m = /limit\s+(\d+)[\s\S]*?requested\s+(\d+)/i.exec(detail);
  return !!m && Number(m[2]) > Number(m[1]);
}

/** The ModelError for a non-2xx reply from an OpenAI-compatible endpoint. */
export function httpError(status: number, detail: string, headers: Headers): ModelError {
  const tooLarge = requestTooLarge(status, detail);
  if (status === 429)
    return new ModelError(`HTTP 429: ${detail}`, true, {
      rateLimited: true,
      retryAfterMs: retryAfterMs(headers, Date.now()),
      ...(tooLarge ? { tooLarge: true } : {}),
    });
  return new ModelError(
    `HTTP ${status}: ${detail}`,
    status >= 500,
    tooLarge ? { tooLarge: true } : undefined,
  );
}

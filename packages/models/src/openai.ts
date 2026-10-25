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
}

type Json = Record<string, unknown>;

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
    async complete(req: RawRequest, signal: AbortSignal): Promise<ModelResponse> {
      const body: Json = {
        model: opts.id,
        messages: toOpenAIMessages(req.system, req.messages),
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
      };
      if (req.tools.length)
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      if (req.responseFormat) body.response_format = req.responseFormat;

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
        const retryable = res.status === 429 || res.status >= 500;
        throw new ModelError(`HTTP ${res.status}: ${detail}`, retryable);
      }

      let data: Json;
      try {
        data = (await res.json()) as Json;
      } catch {
        throw new ModelError('invalid JSON in response body', true);
      }
      const choices = data.choices as Json[] | undefined;
      const message = choices?.[0]?.message as Json | undefined;
      if (!message) throw new ModelError('response has no choices', true);

      const calls = ((message.tool_calls as Json[] | undefined) ?? []).map((c) => {
        const fn = (c.function ?? {}) as Json;
        const raw = typeof fn.arguments === 'string' ? fn.arguments : '';
        let args: unknown;
        try {
          args = raw.trim() ? JSON.parse(raw) : {};
        } catch {
          args = raw;
        }
        return { tool: String(fn.name ?? ''), args };
      });
      const usage = (data.usage ?? {}) as Json;
      const text =
        typeof message.content === 'string' && message.content ? message.content : undefined;
      return {
        ...(text !== undefined && { text }),
        calls,
        usage: {
          inTokens: Number(usage.prompt_tokens ?? 0),
          outTokens: Number(usage.completion_tokens ?? 0),
        },
      };
    },
  };
}

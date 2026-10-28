/*
 * ModelClient for providers that do not speak the OpenAI chat-completions format
 * (Anthropic, Google Gemini), built on the Vercel AI SDK's provider packages.
 *
 * Why the AI SDK and not `@mariozechner/pi-ai` (evaluated 2026-10-26):
 *  - Fit: both cover native Anthropic and Gemini APIs, tool calling, streamed text and
 *    reasoning, and token usage. The AI SDK's provider packages are separate and tiny
 *    (only the two we use are installed); pi-ai pulls in every vendor SDK at once
 *    (openai, @anthropic-ai/sdk, @google/genai, mistral, bedrock, undici, proxy-agent), about
 *    4 MB unpacked before bundling, and its own cost tables would duplicate our catalog.
 *  - Maintenance: AI SDK 7 and its providers publish several times a week (Apache-2.0,
 *    Vercel-backed, model ids track new releases within days). pi-ai's last release at the
 *    time of writing was 0.73 in May 2026, a 0.x API from a single maintainer.
 *  - License: Apache-2.0 vs MIT; both are fine.
 *  - Cost: we use only the provider packages (`@ai-sdk/anthropic`, `@ai-sdk/google`, through
 *    `doStream` on their LanguageModelV4) and not the `ai` umbrella, which drags in the
 *    gateway and OIDC code and doubles the bundle. Providers do no retrying, so our own
 *    retry, abort and ModelError semantics stay in charge (APICallError maps to ModelError).
 * Neither is used for OpenAI-compatible providers: those stay on the in-house client, which
 * has the reasoning-model rules and the streaming behaviour the evals were baselined on.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import {
  APICallError,
  type JSONValue,
  type LanguageModelV4,
  type LanguageModelV4Prompt,
} from '@ai-sdk/provider';
import {
  type Message,
  type ModelCaps,
  type ModelClient,
  ModelError,
  type ModelResponse,
} from '@remy/core';
import { httpError, REASONING_MIN_OUTPUT_TOKENS } from './openai.ts';
import type { RawRequest } from './types.ts';

export type AiSdkKind = 'anthropic' | 'google';

export interface AiSdkClientOptions {
  kind: AiSdkKind;
  id: string;
  apiKey: string;
  baseUrl?: string;
  caps: ModelCaps;
  timeoutMs?: number;
  /** Transport, for tests. */
  fetchImpl?: typeof fetch;
}

/** Claude 4.6 and later (and all of 5.x) take adaptive thinking; older ones need a token budget. */
const ADAPTIVE_CLAUDE = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(?:5|4-[6-9])/;
/** These Gemini families reject or ignore a custom temperature; leave it at the default. */
const FIXED_TEMPERATURE_GEMINI = /^gemini-(?:3|4)/;

function toPrompt(system: string, messages: Message[]): LanguageModelV4Prompt {
  const out: LanguageModelV4Prompt = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    else if (m.role === 'assistant') {
      const content: Extract<LanguageModelV4Prompt[number], { role: 'assistant' }>['content'] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.calls ?? [])
        content.push({
          type: 'tool-call',
          toolCallId: c.callId,
          toolName: c.tool,
          input: c.args ?? {},
        });
      if (content.length) out.push({ role: 'assistant', content });
    } else {
      const part = {
        type: 'tool-result' as const,
        toolCallId: m.callId,
        toolName: m.tool,
        output: { type: 'text' as const, value: m.content },
      };
      // Results of one assistant turn travel together.
      const last = out.at(-1);
      if (last?.role === 'tool') last.content.push(part);
      else out.push({ role: 'tool', content: [part] });
    }
  }
  return out;
}

function toModelError(e: unknown, signal: AbortSignal, timeout: AbortSignal, ms: number) {
  if (e instanceof ModelError) return e;
  if (signal.aborted) return new ModelError('request aborted', false);
  if (timeout.aborted) return new ModelError(`timed out after ${ms}ms`, true);
  if (APICallError.isInstance(e)) {
    const detail = (e.responseBody ?? e.message).slice(0, 500);
    if (e.statusCode !== undefined)
      return httpError(e.statusCode, detail, new Headers(e.responseHeaders));
  }
  return new ModelError(`network error: ${e instanceof Error ? e.message : String(e)}`, true);
}

/** Raw client: like the OpenAI one, it reports tool calls as-is and leaves repair to the strategies. */
export function createAiSdkClient(opts: AiSdkClientOptions): ModelClient {
  const settings = {
    apiKey: opts.apiKey,
    ...(opts.baseUrl && { baseURL: opts.baseUrl }),
    ...(opts.fetchImpl && { fetch: opts.fetchImpl }),
  };
  const model: LanguageModelV4 =
    opts.kind === 'anthropic'
      ? createAnthropic(settings)(opts.id)
      : createGoogle(settings)(opts.id);
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
      // Thinking tokens count against the output limit on both providers.
      const maxTokens = Math.max(req.maxOutputTokens, REASONING_MIN_OUTPUT_TOKENS);
      let providerOptions: Record<string, Record<string, JSONValue>> | undefined;
      if (onReasoning && opts.kind === 'google')
        providerOptions = { google: { thinkingConfig: { includeThoughts: true } } };
      else if (onReasoning && ADAPTIVE_CLAUDE.test(opts.id))
        providerOptions = { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } };
      const sendTemperature = opts.kind === 'google' && !FIXED_TEMPERATURE_GEMINI.test(opts.id);

      const timeout = AbortSignal.timeout(timeoutMs);
      let text = '';
      const calls: { tool: string; args: unknown }[] = [];
      let finish: string | undefined;
      let usage = { inTokens: 0, outTokens: 0 };
      try {
        const { stream } = await model.doStream({
          prompt: toPrompt(req.system, req.messages),
          ...(req.tools.length && {
            tools: req.tools.map((t) => ({
              type: 'function' as const,
              name: t.name,
              description: t.description,
              inputSchema: t.parameters as never,
            })),
          }),
          maxOutputTokens: maxTokens,
          ...(sendTemperature && { temperature: req.temperature }),
          ...(providerOptions && { providerOptions }),
          abortSignal: AbortSignal.any([signal, timeout]),
        });
        const reader = stream.getReader();
        for (;;) {
          const { done, value: part } = await reader.read();
          if (done) break;
          if (part.type === 'text-delta') {
            text += part.delta;
            onText?.(part.delta);
          } else if (part.type === 'reasoning-delta') onReasoning?.(part.delta);
          else if (part.type === 'tool-call') {
            let args: unknown = part.input;
            try {
              args = part.input.trim() ? JSON.parse(part.input) : {};
            } catch {
              // Left as the raw string; the tool strategies treat that as a bad call.
            }
            calls.push({ tool: part.toolName, args });
          } else if (part.type === 'finish') {
            finish = part.finishReason.unified;
            usage = {
              inTokens: part.usage.inputTokens.total ?? 0,
              outTokens: part.usage.outputTokens.total ?? 0,
            };
          } else if (part.type === 'error') throw part.error;
        }
      } catch (e) {
        throw toModelError(e, signal, timeout, timeoutMs);
      }
      if (signal.aborted) throw new ModelError('request aborted', false);
      if (!text.trim() && calls.length === 0 && finish === 'length')
        throw new ModelError(
          `the reply hit the ${maxTokens}-token output limit before producing anything`,
          true,
        );
      return { ...(text && { text }), calls, usage };
    },
  };
}

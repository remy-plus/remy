import type { ModelClient } from '@remy/core';
import { createAiSdkClient } from './ai-sdk-client.ts';
import { BUILTIN_CATALOG, type Catalog, resolveCaps } from './catalog.ts';
import { createOpenAIClient, REASONING_EFFORTS, type ReasoningEffort } from './openai.ts';
import { selectStrategy } from './strategy.ts';

export interface Profile {
  /** Wire format. Default `openai`: any OpenAI-compatible chat-completions API. */
  kind?: 'openai' | 'anthropic' | 'google';
  baseUrl: string;
  /** Env var holding the API key, if the provider needs one. */
  keyEnv?: string;
  /** Set when listing models proves nothing about the key: a key check asks this model instead. */
  keyCheckModel?: string;
  /** Prices this provider charges, where they differ from the model maker's (a router's own rates). */
  catalog?: Catalog;
}

export const PROFILES: Record<string, Profile> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1' },
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  deepseek: { baseUrl: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
  together: { baseUrl: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1', keyEnv: 'FIREWORKS_API_KEY' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', keyEnv: 'CEREBRAS_API_KEY' },
  nebius: { baseUrl: 'https://api.tokenfactory.nebius.com/v1', keyEnv: 'NEBIUS_API_KEY' },
  moonshot: { baseUrl: 'https://api.moonshot.ai/v1', keyEnv: 'MOONSHOT_API_KEY' },
  zai: { baseUrl: 'https://api.z.ai/api/paas/v4', keyEnv: 'ZHIPU_API_KEY' },
  deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai', keyEnv: 'DEEPINFRA_API_KEY' },
  alibaba: {
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyEnv: 'DASHSCOPE_API_KEY',
  },
  inception: {
    baseUrl: 'https://api.inceptionlabs.ai/v1',
    keyEnv: 'INCEPTION_API_KEY',
    keyCheckModel: 'mercury-2',
  },
  // 0G Private Computer: a router with its own rates (pricing_usd in its model list, read
  // 2026-11-07). No cache-read price is listed, so input is billed in full here.
  zerog: {
    baseUrl: 'https://router-api.0g.ai/v1',
    keyEnv: 'ZEROG_API_KEY',
    keyCheckModel: 'gpt-5-nano',
    catalog: {
      'claude-haiku-5.5': {
        contextTokens: 131072,
        contextWindow: 1000000,
        pricing: { inPerMTok: 0.1, outPerMTok: 0.5 },
      },
      'claude-sonnet-5.5': {
        contextTokens: 131072,
        contextWindow: 1000000,
        pricing: { inPerMTok: 2, outPerMTok: 10 },
      },
      'glm-5.3-flash': {
        contextTokens: 131072,
        contextWindow: 1000000,
        pricing: { inPerMTok: 0.09, outPerMTok: 0.315 },
      },
      'gpt-5-nano': {
        contextTokens: 131072,
        contextWindow: 400000,
        pricing: { inPerMTok: 0.05, outPerMTok: 0.4 },
      },
    },
  },
  zro: {
    baseUrl: 'https://zro.moonmath.ai/v1',
    keyEnv: 'ZRO_API_KEY',
    keyCheckModel: 'deepseek-v4.1-flash',
  },
  // Native APIs (not OpenAI-compatible), served by the AI SDK client.
  anthropic: {
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  google: {
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
  },
};

/** Every provider's key variable. Tools never see these, and a new provider is covered at once. */
export const PROFILE_KEY_ENVS = Object.values(PROFILES).flatMap((p) =>
  p.keyEnv ? [p.keyEnv] : [],
);

type Env = Record<string, string | undefined>;

/** Builds a client from REMY_PROFILE / REMY_BASE_URL / REMY_API_KEY / REMY_MODEL. */
export function modelFromEnv(env: Env, catalog?: Catalog): ModelClient {
  const name = env.REMY_PROFILE;
  const profile = name ? PROFILES[name] : undefined;
  if (name && !profile)
    throw new Error(
      `unknown REMY_PROFILE "${name}". Known profiles: ${Object.keys(PROFILES).join(', ')}`,
    );
  const baseUrl = env.REMY_BASE_URL ?? profile?.baseUrl;
  if (!baseUrl) throw new Error('set REMY_PROFILE or REMY_BASE_URL');
  const model = env.REMY_MODEL;
  if (!model) throw new Error('set REMY_MODEL');
  const apiKey = env.REMY_API_KEY ?? (profile?.keyEnv ? env[profile.keyEnv] : undefined);
  const caps = resolveCaps(model, { ...BUILTIN_CATALOG, ...profile?.catalog, ...catalog });
  const effort = env.REMY_REASONING?.toLowerCase();
  if (effort && !(REASONING_EFFORTS as readonly string[]).includes(effort))
    throw new Error(`REMY_REASONING must be one of ${REASONING_EFFORTS.join(', ')}`);
  const reasoningEffort = effort as ReasoningEffort | undefined;
  const kind = profile?.kind ?? 'openai';
  if (kind !== 'openai' && !apiKey)
    throw new Error(`the ${name} profile needs an API key (${profile?.keyEnv})`);
  const raw =
    kind === 'openai'
      ? createOpenAIClient({
          id: model,
          baseUrl,
          ...(apiKey && { apiKey }),
          caps,
          ...(reasoningEffort && { reasoningEffort }),
        })
      : createAiSdkClient({ kind, id: model, baseUrl, apiKey: apiKey as string, caps });
  return selectStrategy(raw);
}

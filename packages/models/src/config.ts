import type { ModelClient } from '@remy/core';
import { BUILTIN_CATALOG, type Catalog, resolveCaps } from './catalog.ts';
import { createOpenAIClient } from './openai.ts';
import { selectStrategy } from './strategy.ts';

export interface Profile {
  baseUrl: string;
  /** Env var holding the API key, if the provider needs one. */
  keyEnv?: string;
}

export const PROFILES: Record<string, Profile> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1' },
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
};

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
  const raw = createOpenAIClient({
    id: model,
    baseUrl,
    ...(apiKey && { apiKey }),
    caps: resolveCaps(model, { ...BUILTIN_CATALOG, ...catalog }),
  });
  return selectStrategy(raw);
}

// `remy login`, `remy login --list`, `remy logout`: what they do, apart from the picker screen.
import { PROFILES, verifyKey } from '@remy/models';
import type { Credentials } from './credentials.ts';
import type { LoginEntry, LoginResult, ProviderChoice } from './login-ui.ts';

const LABELS: Record<string, { label: string; model?: string; keyUrl?: string }> = {
  openai: { label: 'OpenAI', model: 'gpt-5-nano', keyUrl: 'platform.openai.com/api-keys' },
  openrouter: { label: 'OpenRouter', model: 'openai/gpt-5-nano', keyUrl: 'openrouter.ai/keys' },
  groq: { label: 'Groq', model: 'qwen/qwen3.8-27b', keyUrl: 'console.groq.com/keys' },
  anthropic: {
    label: 'Anthropic',
    model: 'claude-haiku-5-5',
    keyUrl: 'console.anthropic.com/settings/keys',
  },
  google: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash',
    keyUrl: 'aistudio.google.com/apikey',
  },
  deepseek: {
    label: 'DeepSeek',
    model: 'deepseek-flash',
    keyUrl: 'platform.deepseek.com/api_keys',
  },
  mistral: { label: 'Mistral', model: 'ministral-3b-2512', keyUrl: 'console.mistral.ai/api-keys' },
  xai: { label: 'xAI Grok', model: 'grok-4.3', keyUrl: 'console.x.ai' },
  together: {
    label: 'Together AI',
    model: 'zai-org/GLM-5.3-Flash',
    keyUrl: 'api.together.ai/settings/api-keys',
  },
  fireworks: {
    label: 'Fireworks AI',
    model: 'accounts/fireworks/models/glm-5p3-flash',
    keyUrl: 'fireworks.ai/api-keys',
  },
  cerebras: { label: 'Cerebras', model: 'gpt-oss-120b', keyUrl: 'cloud.cerebras.ai' },
  nebius: {
    label: 'Nebius',
    model: 'nvidia/Nemotron-3_5-Lightning',
    keyUrl: 'tokenfactory.nebius.com',
  },
  ollama: { label: 'Ollama (on this computer, no key)', model: 'llama3.1' },
};

/** The model a provider starts with when the user names none. */
export const defaultModelFor = (provider: string): string | undefined => LABELS[provider]?.model;

/** A few models worth offering per provider in `/model`; any other id can be typed. */
export const SUGGESTED_MODELS: Record<string, string[]> = {
  openai: ['gpt-5-nano', 'gpt-4o-mini', 'gpt-4o'],
  openrouter: [
    'openai/gpt-5-nano',
    'meta-llama/llama-3.3-70b-instruct',
    'google/gemma-4-26b-a4b-it:free',
  ],
  groq: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  google: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  mistral: ['ministral-3b-2512'],
  xai: ['grok-4.3'],
  together: ['zai-org/GLM-5.3-Flash'],
  fireworks: ['accounts/fireworks/models/glm-5p3-flash'],
  cerebras: ['gpt-oss-120b', 'qwen-3.8-27b'],
  nebius: ['nvidia/Nemotron-3_5-Lightning'],
  ollama: ['llama3.1', 'llama3.2', 'qwen2.5'],
};

/** Every profile, then a custom OpenAI-compatible endpoint. */
export function providerChoices(): ProviderChoice[] {
  const order = ['openai', 'openrouter', 'groq', 'anthropic', 'google', 'ollama'];
  const names = [
    ...order.filter((n) => n in PROFILES),
    ...Object.keys(PROFILES).filter((n) => !order.includes(n)),
  ];
  return [
    ...names.map((id) => {
      const l = LABELS[id];
      return {
        id,
        label: l?.label ?? id,
        needsKey: Boolean(PROFILES[id]?.keyEnv),
        ...(l?.model && { exampleModel: l.model }),
        ...(l?.keyUrl && { keyUrl: l.keyUrl }),
      };
    }),
    {
      id: 'custom',
      label: 'Custom base URL (OpenAI-compatible)',
      needsKey: true,
      needsBaseUrl: true,
    },
  ];
}

export interface LoginDeps {
  credentials: Credentials;
  fetch?: typeof fetch;
}

/** Verifies the key with one cheap request, then saves it. A bad key is not saved. */
export async function saveLogin(deps: LoginDeps, entry: LoginEntry): Promise<LoginResult> {
  const profile = PROFILES[entry.provider];
  const baseUrl = entry.baseUrl ?? profile?.baseUrl;
  if (!baseUrl) return { ok: false, message: `Unknown provider "${entry.provider}".` };
  if (entry.provider === 'custom' && !/^https?:\/\//.test(baseUrl))
    return { ok: false, message: 'The base URL should start with http:// or https://.' };
  const needsKey = entry.provider === 'custom' || Boolean(profile?.keyEnv);
  if (needsKey && !entry.key)
    return { ok: false, message: 'No key was given. Pass it on stdin with --key-stdin.' };
  const check = await verifyKey({
    ...(profile?.kind && { kind: profile.kind }),
    baseUrl,
    ...(entry.key && { key: entry.key }),
    ...(deps.fetch && { fetchImpl: deps.fetch }),
  });
  if (check === 'rejected')
    return { ok: false, message: 'That key was not accepted. Check it and try again.' };
  const store = deps.credentials.save(entry.provider, entry.key, {
    ...(entry.model && { model: entry.model }),
    ...(entry.provider === 'custom' && { baseUrl }),
  });
  const where =
    store === 'keychain' ? 'in the macOS Keychain' : store === 'file' ? 'in REMY_HOME' : '';
  const unchecked =
    check === 'unreachable' ? ` Could not reach ${new URL(baseUrl).host} to check it.` : '';
  return {
    ok: true,
    message: `Connected ${entry.provider}${where ? `, key saved ${where}` : ''}.${unchecked} Run remy to start.`,
  };
}

/** `remy login --list`: providers and defaults, never keys. */
export function listLogins(credentials: Credentials): string[] {
  const rows = credentials.list();
  if (!rows.length) return ['No saved logins. Run remy login to connect a provider.'];
  const w = Math.max(...rows.map((r) => r.provider.length));
  return rows.map(
    (r) =>
      `${r.provider.padEnd(w)}  ${r.store === 'none' ? 'no key needed' : r.store}${r.model ? `  ${r.model}` : ''}${r.baseUrl ? `  ${r.baseUrl}` : ''}${r.isDefault ? '  (default)' : ''}`,
  );
}

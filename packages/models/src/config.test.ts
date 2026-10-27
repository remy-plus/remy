import { describe, expect, it } from 'vitest';
import { modelFromEnv, PROFILES } from './config.ts';

describe('modelFromEnv', () => {
  it('builds from a profile with catalog caps', () => {
    const c = modelFromEnv({ REMY_PROFILE: 'ollama', REMY_MODEL: 'gemma2' });
    expect(c.id).toBe('gemma2');
    expect(c.caps.nativeTools).toBe(false);
  });

  it('lets a user catalog override built-ins', () => {
    const c = modelFromEnv(
      { REMY_PROFILE: 'ollama', REMY_MODEL: 'gemma2' },
      { gemma2: { nativeTools: true } },
    );
    expect(c.caps.nativeTools).toBe(true);
  });

  it('uses profile key env and explicit vars override the profile', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }));
    }) as unknown as typeof fetch;
    try {
      const req = {
        system: '',
        messages: [{ role: 'user' as const, content: 'hi' }],
        tools: [],
        maxOutputTokens: 10,
        temperature: 0,
      };
      const sig = new AbortController().signal;
      await modelFromEnv({
        REMY_PROFILE: 'openrouter',
        REMY_MODEL: 'm',
        OPENROUTER_API_KEY: 'or-key',
      }).complete(req, sig);
      await modelFromEnv({
        REMY_PROFILE: 'openrouter',
        REMY_MODEL: 'm',
        OPENROUTER_API_KEY: 'or-key',
        REMY_BASE_URL: 'http://local/v1',
        REMY_API_KEY: 'mine',
      }).complete(req, sig);
      await modelFromEnv({
        REMY_PROFILE: 'groq',
        REMY_MODEL: 'llama-3.3-70b-versatile',
        GROQ_API_KEY: 'gq-key',
      }).complete(req, sig);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen[0]?.url).toBe(`${PROFILES.openrouter?.baseUrl}/chat/completions`);
    expect(seen[0]?.headers.authorization).toBe('Bearer or-key');
    expect(seen[1]?.url).toBe('http://local/v1/chat/completions');
    expect(seen[1]?.headers.authorization).toBe('Bearer mine');
    expect(seen[2]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(seen[2]?.headers.authorization).toBe('Bearer gq-key');
  });

  it('errors on missing or unknown config', () => {
    expect(() => modelFromEnv({ REMY_MODEL: 'm' })).toThrow(/REMY_PROFILE or REMY_BASE_URL/);
    expect(() => modelFromEnv({ REMY_PROFILE: 'ollama' })).toThrow(/REMY_MODEL/);
    expect(() => modelFromEnv({ REMY_PROFILE: 'zzz', REMY_MODEL: 'm' })).toThrow(/unknown/);
  });
});

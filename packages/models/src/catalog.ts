import { readFileSync } from 'node:fs';
import type { ModelCaps } from '@remy/core';

export type Catalog = Record<string, Partial<ModelCaps>>;

export const DEFAULT_CAPS: ModelCaps = {
  nativeTools: true,
  jsonSchema: false,
  contextTokens: 32768,
  pricing: { inPerMTok: 0, outPerMTok: 0 },
};

/** Only ids and prices we are sure of; anything uncertain stays at the default (0) until a user models.json says otherwise. */
export const BUILTIN_CATALOG: Catalog = {
  'openai/gpt-4o-mini': {
    jsonSchema: true,
    contextTokens: 128000,
    pricing: { inPerMTok: 0.15, outPerMTok: 0.6 },
  },
  'openai/gpt-4o': {
    jsonSchema: true,
    contextTokens: 128000,
    pricing: { inPerMTok: 2.5, outPerMTok: 10 },
  },
  'gpt-4o-mini': {
    jsonSchema: true,
    contextTokens: 128000,
    pricing: { inPerMTok: 0.15, outPerMTok: 0.6 },
  },
  'gpt-4o': {
    jsonSchema: true,
    contextTokens: 128000,
    pricing: { inPerMTok: 2.5, outPerMTok: 10 },
  },
  // Free OpenRouter tier: price is 0.
  'google/gemma-4-26b-a4b-it:free': {
    jsonSchema: true,
    contextTokens: 262144,
    pricing: { inPerMTok: 0, outPerMTok: 0 },
  },
  'nvidia/nemotron-3-super-120b-a12b:free': {
    jsonSchema: true,
    contextTokens: 262144,
    pricing: { inPerMTok: 0, outPerMTok: 0 },
  },
  'liquid/lfm-2.5-2.6b:free': {
    jsonSchema: true,
    contextTokens: 65536,
    pricing: { inPerMTok: 0, outPerMTok: 0 },
  },
  // Paid OpenRouter and OpenAI models (USD per million tokens, from the OpenRouter listing).
  'qwen/qwen-2.5-7b-instruct': {
    jsonSchema: true,
    contextTokens: 32768,
    pricing: { inPerMTok: 0.1, outPerMTok: 0.2 },
  },
  'meta-llama/llama-3.3-70b-instruct': {
    jsonSchema: true,
    contextTokens: 131072,
    pricing: { inPerMTok: 0.1, outPerMTok: 0.32 },
  },
  'openai/gpt-5-nano': {
    jsonSchema: true,
    contextTokens: 400000,
    pricing: { inPerMTok: 0.05, outPerMTok: 0.4 },
  },
  'gpt-5-nano': {
    jsonSchema: true,
    contextTokens: 400000,
    pricing: { inPerMTok: 0.05, outPerMTok: 0.4 },
  },
  // Ollama local models run for free.
  'llama3.1': { contextTokens: 32768 },
  'llama3.2': { contextTokens: 32768 },
  'qwen2.5': { contextTokens: 32768 },
  // No native tool support in Ollama: use the JSON strategy.
  gemma2: { nativeTools: false, contextTokens: 8192 },
  phi3: { nativeTools: false, contextTokens: 4096 },
};

export function resolveCaps(modelId: string, catalog: Catalog = BUILTIN_CATALOG): ModelCaps {
  const entry = catalog[modelId] ?? {};
  return {
    ...DEFAULT_CAPS,
    ...entry,
    pricing: { ...DEFAULT_CAPS.pricing, ...entry.pricing },
  };
}

/** Reads a user `models.json`: `{ [modelId]: Partial<ModelCaps> }`. */
export function loadCatalog(path: string): Catalog {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`${path}: expected an object keyed by model id`);
  return data as Catalog;
}

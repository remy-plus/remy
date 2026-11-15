// Adding a model key from the browser: GET /api/setup/model says whether Remy has a model and offers a
// short list of providers; POST /api/setup/model checks a key with one small real request, saves it
// (macOS Keychain, else a 0600 file in REMY_HOME, through the same code as `remy login`) and puts the
// model to work at once, with no restart.
//
// Why this is safe to expose (all of it tested):
//  - it sits behind the same bearer token, Host and cross-site checks as every route;
//  - the body names a provider from a fixed list, never an address, so the server can only ever send the
//    key to that provider's own endpoint (no request forgery, no key sent to a stranger);
//  - the key is read once, registered with the redactor before anything else happens, never logged,
//    never put in an error, and never returned: no route gives a saved key back;
//  - nothing is saved unless the key passed a real request, so a typo cannot replace a working key;
//  - one check at a time, and a handful a minute, so the route is no way to guess keys.
import type { ModelClient } from '@remy/core';
import { ModelError } from '@remy/core';
import { PROFILES, verifyKey } from '@remy/models';
import { z } from 'zod';
import type { Credentials } from './credentials.ts';
import { defaultModelFor, providerChoices } from './login.ts';
import type { ModelSlot } from './model-slot.ts';
import { guard, HttpFail, jsonBody, type Mount, methodNotAllowed, ok } from './serve-mount.ts';

/**
 * The providers offered in the browser, in the order of their price: the cheapest good one first. The
 * model each uses is the default of `remy login`. A custom address is terminal-only on purpose.
 */
export const SETUP_PROVIDERS = ['openai', 'openrouter', 'anthropic', 'google', 'ollama'] as const;
export type SetupProvider = (typeof SETUP_PROVIDERS)[number];

const NOTES: Record<SetupProvider, string> = {
  openai: 'Pay as you go. The cheapest way to start.',
  openrouter: 'One key for many models, and some are free.',
  anthropic: 'Claude models. Pay as you go.',
  google: 'Gemini models. Pay as you go.',
  ollama: 'Free and private, on this computer. Needs Ollama running.',
};

export interface SetupChoice {
  id: SetupProvider;
  label: string;
  model: string;
  note: string;
  needsKey: boolean;
  /** Where to get a key, without the scheme (shown as text; the page adds the link). */
  keyUrl?: string;
}

/** The short list the browser shows. */
export function setupChoices(): SetupChoice[] {
  const all = providerChoices();
  return SETUP_PROVIDERS.flatMap((id) => {
    const c = all.find((x) => x.id === id);
    const model = defaultModelFor(id);
    if (!c || !model) return [];
    return [
      {
        id,
        label: c.label,
        model,
        note: NOTES[id],
        needsKey: c.needsKey,
        ...(c.keyUrl && { keyUrl: c.keyUrl }),
      },
    ];
  });
}

const body = z
  .object({
    provider: z.enum(SETUP_PROVIDERS),
    key: z.string().max(600).optional(),
  })
  .strict();

/**
 * What a pasted key can look like: letters, digits and `_ - . : ~ + / =`, which covers every
 * provider's keys. Anything else (a space, a quote, a line break, a control character) is refused, so
 * nothing odd ever reaches the Keychain command or a header.
 */
const KEY_SHAPE = /^[A-Za-z0-9_\-.:~+/=]{8,600}$/;

export const MSG = {
  noKey: 'Paste the key first. It is the long line of letters and digits from your provider.',
  badShape:
    'That does not look like a key. Copy it again from your provider, with no spaces or line breaks.',
  rejected: (label: string) =>
    `${label} did not accept that key. Check that you copied all of it, then paste it again.`,
  noCredit: (label: string, where?: string) =>
    `That key works, but the ${label} account has no credit left. Add some${where ? ` at ${where}` : ''}, then try again.`,
  unreachable: (label: string) =>
    `Remy could not reach ${label}. Check your internet connection, then try again.`,
  noOllama:
    'Remy could not find Ollama on this computer. Start Ollama, or pick a provider with a key.',
  noModel: (label: string, model: string) =>
    `${label} accepted the key but would not use ${model}. Try another provider.`,
  busyProvider: (label: string) =>
    `${label} is busy or limiting this key. Wait a minute, then try again.`,
  other: (label: string) =>
    `${label} did not answer the check. Try again in a moment; if it keeps happening, check the key with ${label}.`,
  tooMany: 'That is a lot of tries. Wait a minute, then try again.',
  working: 'Remy is still checking the last key. Wait a moment, then try again.',
  notSaved:
    'Remy could not save the key on this computer. Check that its data folder can be written, then try again.',
} as const;

/** Maps a failure of the small test request to one plain sentence. Never repeats the provider's own text. */
export function explainSetupFailure(
  e: unknown,
  c: Pick<SetupChoice, 'label' | 'model' | 'keyUrl' | 'id'>,
): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/http (401|403)\b|invalid api key|incorrect api key|unauthorized|api_key_invalid/.test(m))
    return MSG.rejected(c.label);
  if (
    /insufficient_quota|exceeded your current quota|http 402|out of credit|billing|credit/.test(m)
  )
    return MSG.noCredit(c.label, c.keyUrl);
  if (/http 404|model_not_found|does not exist/.test(m) && /model/.test(m))
    return MSG.noModel(c.label, c.model);
  if (/http 429|rate limit|too many requests|overloaded/.test(m)) return MSG.busyProvider(c.label);
  if (
    (e instanceof ModelError && (e.unreachable || e.timedOut)) ||
    /timed out|etimedout|network error|fetch failed|enotfound|econnrefused|econnreset|http 5\d\d\b/.test(
      m,
    )
  )
    return c.id === 'ollama' ? MSG.noOllama : MSG.unreachable(c.label);
  return MSG.other(c.label);
}

export interface ModelSetupDeps {
  credentials: Credentials;
  slot: ModelSlot;
  /** Builds the client for a provider, model and key (default for the CLI: `modelFromEnv`). */
  build(provider: SetupProvider, model: string, key: string): ModelClient;
  /** Tells the redactor about a key before anything else is done with it. */
  onKey(key: string): void;
  /** Called after a key is saved and the model is in use. */
  onSaved?(provider: SetupProvider): void;
  /** For tests: the fetch the key check uses. */
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const WINDOW_MS = 60_000;
const MAX_TRIES = 8;

export function createModelSetupMount(d: ModelSetupDeps): Mount {
  const now = d.now ?? Date.now;
  const tries: number[] = [];
  let busy = false;

  const label = (id: string) => setupChoices().find((c) => c.id === id)?.label ?? id;
  const current = () => {
    if (!d.slot.ready()) return null;
    // The index holds names only; reading the key itself would ask the Keychain on every page load.
    const saved = d.credentials.list().find((l) => l.isDefault);
    return saved
      ? {
          provider: saved.provider,
          label: label(saved.provider),
          model: saved.model ?? d.slot.client.id,
        }
      : { provider: null, label: null, model: d.slot.client.id };
  };

  return guard(async ({ req, method, parts }) => {
    if (parts[0] !== 'setup' || parts[1] !== 'model' || parts.length !== 2) return undefined;
    if (method === 'GET') {
      return ok({
        ready: d.slot.ready(),
        // What is in use, by name only. A key never leaves the machine.
        current: current(),
        choices: setupChoices(),
      });
    }
    if (method !== 'POST') return methodNotAllowed('GET', 'POST');

    const { provider, key: raw } = await jsonBody(req, body);
    const choice = setupChoices().find((c) => c.id === provider);
    if (!choice) throw new HttpFail(400, 'That provider is not on the list.');
    const key = (raw ?? '').trim();
    // Before anything else: from here on the key is a secret in every log line and error.
    if (key) d.onKey(key);
    if (choice.needsKey && !key) throw new HttpFail(400, MSG.noKey);
    if (key && !KEY_SHAPE.test(key)) throw new HttpFail(400, MSG.badShape);
    if (!choice.needsKey && key) throw new HttpFail(400, `${choice.label} needs no key.`);

    const t = now();
    while (tries.length && t - (tries[0] as number) > WINDOW_MS) tries.shift();
    if (tries.length >= MAX_TRIES) throw new HttpFail(429, MSG.tooMany);
    if (busy) throw new HttpFail(429, MSG.working);
    tries.push(t);
    busy = true;
    try {
      const profile = PROFILES[provider];
      if (!profile) throw new HttpFail(400, 'That provider is not on the list.');
      const check = await verifyKey({
        ...(profile.kind && { kind: profile.kind }),
        baseUrl: profile.baseUrl,
        ...(key && { key }),
        ...(profile.keyCheckModel && { chatModel: profile.keyCheckModel }),
        ...(d.fetch && { fetchImpl: d.fetch }),
        ...(d.timeoutMs && { timeoutMs: d.timeoutMs }),
      });
      if (check === 'rejected') throw new HttpFail(400, MSG.rejected(choice.label));
      if (check === 'unreachable')
        throw new HttpFail(
          502,
          provider === 'ollama' ? MSG.noOllama : MSG.unreachable(choice.label),
        );

      // The key is good. One small real request shows the account can pay for an answer.
      let model: ModelClient;
      try {
        model = d.build(provider, choice.model, key);
      } catch {
        throw new HttpFail(400, MSG.other(choice.label));
      }
      try {
        await model.complete(
          {
            system: 'Answer with one word.',
            messages: [{ role: 'user', content: 'ok?' }],
            tools: [],
            maxOutputTokens: 16,
            temperature: 0,
          },
          AbortSignal.timeout(d.timeoutMs ?? 20_000),
        );
      } catch (e) {
        // A model that answers with nothing at all still proves the key and the credit.
        if (!(e instanceof Error && /empty reply/i.test(e.message)))
          throw new HttpFail(
            /credit|quota|402/i.test(e instanceof Error ? e.message : '') ? 402 : 502,
            explainSetupFailure(e, choice),
          );
      }

      let store: 'keychain' | 'file' | 'none';
      try {
        store = d.credentials.save(provider, key, { model: choice.model });
      } catch {
        throw new HttpFail(500, MSG.notSaved);
      }
      d.slot.set(model);
      d.onSaved?.(provider);
      return ok({
        ok: true,
        current: { provider, label: choice.label, model: choice.model },
        saved:
          store === 'keychain'
            ? 'in the macOS Keychain on this computer'
            : store === 'file'
              ? 'in a private file on this computer'
              : 'nowhere (no key was needed)',
      });
    } finally {
      busy = false;
    }
  });
}

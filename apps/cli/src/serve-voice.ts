// `remy serve` spoken replies: the web app sends a short piece of text, this turns it into audio with
// Fish Audio and sends the bytes back. The Fish key stays here: it is read from the environment
// (FISH_API_KEY) or the macOS Keychain (service `remy`, account `fish`) and never reaches the
// browser, a log, an error message or a response.
//
//   POST /api/voice/speak   { text }  ->  audio/mpeg
//
// Fish API (docs.fish.audio, checked 2026-11-10): POST https://api.fish.audio/v1/tts with
// `Authorization: Bearer <key>`, a `model` header, and a JSON body { text, reference_id, format,
// latency }. The answer is chunked audio; each piece here is short, so it is read whole.
// Answers: 503 with a plain message when there is no key (the web app then uses the browser's voice),
// 413 for text over the cap, 429 while too many are in flight, 402/502/504 when Fish refuses, fails
// or is slow. Every successful call is counted in `voice-usage.json` and added to the month's spend.
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type Exec, KEYCHAIN_SERVICE, keychainGet, realExec } from './credentials.ts';
import { guard, HttpFail, jsonBody, type Mount, methodNotAllowed } from './serve-mount.ts';

export const FISH_URL = 'https://api.fish.audio/v1/tts';
/** The voice model id (Fish `reference_id`) used until the person picks another. */
export const DEFAULT_VOICE_ID = 'e13fa398a7f445a685316a3de6089ce7';
/** Fish's free model: it works on a free Fish account, which is what most people will have. */
export const FISH_MODEL = 's2.1-pro-free';
/** Fish bills text by UTF-8 byte: US dollars per million bytes, by model (docs.fish.audio pricing). */
const PRICE_PER_MILLION_BYTES: Record<string, number> = {
  's2.1-pro': 15,
  's2-pro': 15,
  s1: 15,
  'drama-3': 50,
  's2.1-pro-free': 0,
};
export const VOICE_TEXT_MAX = 1000;
export const VOICE_TIMEOUT_MS = 15_000;
export const VOICE_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_IN_FLIGHT = 3;

/** A Fish voice model id: letters, digits, `-` and `_`, so it is safe in a request body and in a file. */
export const VOICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const MSG_NO_KEY =
  "Remy has no voice key yet, so it uses your browser's voice. Add one with: security add-generic-password -s remy -a fish -w";

/** The Fish key: FISH_API_KEY first, then the Keychain (macOS only, and not when REMY_KEYCHAIN=off). */
export function readFishKey(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  exec: Exec = realExec,
): string | undefined {
  const fromEnv = env.FISH_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (platform !== 'darwin' || env.REMY_KEYCHAIN === 'off') return undefined;
  return keychainGet(exec, 'fish')?.trim() || undefined;
}

/** Runs a command without blocking the server; `timedOut` is true when it was killed for being slow. */
export type AsyncExec = (
  cmd: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ status: number | null; stdout: string }>;

export const realAsyncExec: AsyncExec = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
        (err, stdout) => {
          if (!err) return resolve({ status: 0, stdout });
          const code = (err as { code?: unknown }).code;
          resolve({ status: typeof code === 'number' ? code : null, stdout: '' });
        },
      );
    } catch {
      resolve({ status: null, stdout: '' });
    }
  });

/** How long a Keychain read may take. A locked Keychain waits for a prompt; that counts as "no key". */
export const KEYCHAIN_TIMEOUT_MS = 2000;

/** Like `readFishKey`, but never blocks the server and gives up on a slow or locked Keychain. */
export async function readFishKeyAsync(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  exec: AsyncExec = realAsyncExec,
  timeoutMs = KEYCHAIN_TIMEOUT_MS,
): Promise<string | undefined> {
  const fromEnv = env.FISH_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (platform !== 'darwin' || env.REMY_KEYCHAIN === 'off') return undefined;
  try {
    const r = await exec(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'fish', '-w'],
      timeoutMs,
    );
    const value = r.stdout.replace(/\r?\n$/, '').trim();
    return r.status === 0 && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The key, cached for `ttlMs` (a lookup in flight is shared). `peek` answers at once from the cache. */
export function createFishKeySource(
  read: () => Promise<string | undefined>,
  ttlMs = 30_000,
  now: () => number = Date.now,
) {
  let cache: { at: number; key: string | undefined } | undefined;
  let inflight: Promise<string | undefined> | undefined;
  const refresh = () => {
    inflight ??= read()
      .catch(() => undefined)
      .then((key) => {
        cache = { at: now(), key };
        return key;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
  return {
    get: (): Promise<string | undefined> =>
      cache && now() - cache.at <= ttlMs ? Promise.resolve(cache.key) : refresh(),
    /** The last known key without waiting; starts a refresh when it is stale. */
    peek: (): string | undefined => {
      if (!cache || now() - cache.at > ttlMs) void refresh();
      return cache?.key;
    },
  };
}

// ---- what voice has cost this month

export interface VoiceLedger {
  record(bytes: number, usd: number): void;
  /** Dollars spent on voice in the month of `at`. */
  monthUsd(at?: Date): number;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Counts calls, bytes and dollars per month in REMY_HOME/voice-usage.json (0600, atomic). */
export function openVoiceLedger(
  home: string,
  now: () => Date = () => new Date(),
  log: (line: string) => void = () => {},
): VoiceLedger {
  const file = join(home, 'voice-usage.json');
  type Row = { calls: number; bytes: number; usd: number };
  const read = (): Record<string, Row> => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, Row>)
        : {};
    } catch {
      return {};
    }
  };
  return {
    record(bytes, usd) {
      const all = read();
      const k = monthKey(now());
      const row = all[k] ?? { calls: 0, bytes: 0, usd: 0 };
      all[k] = { calls: row.calls + 1, bytes: row.bytes + bytes, usd: row.usd + usd };
      try {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
      } catch (e) {
        // The words were already spoken, so the call still succeeds; but a ledger that cannot be
        // written means the month's voice spend is undercounted, and that is worth a line.
        log(
          `voice-usage.json could not be written: ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    },
    monthUsd(at = now()) {
      const n = read()[monthKey(at)]?.usd;
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    },
  };
}

// ---- the route

export interface VoiceMountDeps {
  /** The Fish key, or undefined when there is none. Read on each request, so adding one needs no restart. */
  key(): string | undefined | Promise<string | undefined>;
  /** The voice model id to speak with (a setting). */
  voiceId(): string;
  ledger?: VoiceLedger;
  /** Called when a key was found that differs from the last one, so redaction can hide it. */
  onKey?(key: string): void;
  /** Throws (HttpError 402) when the month's budget is used up, so no more audio is bought. */
  assertBudget?(): Promise<void> | void;
  fetch?: typeof fetch;
  model?: string;
  timeoutMs?: number;
  maxChars?: number;
  url?: string;
}

const speakBody = z.object({ text: z.string() }).strict();

export function createVoiceMount(deps: VoiceMountDeps): Mount {
  const doFetch = deps.fetch ?? fetch;
  const model = deps.model ?? FISH_MODEL;
  const timeoutMs = deps.timeoutMs ?? VOICE_TIMEOUT_MS;
  const maxChars = deps.maxChars ?? VOICE_TEXT_MAX;
  const url = deps.url ?? FISH_URL;
  let inFlight = 0;
  let lastKey: string | undefined;

  return guard(async ({ req, method, parts }) => {
    if (parts[0] !== 'voice' || parts[1] !== 'speak' || parts.length !== 2) return undefined;
    if (method !== 'POST') return methodNotAllowed('POST');

    const { text: raw } = await jsonBody(req, speakBody);
    const text = raw.trim();
    if (!text) throw new HttpFail(400, 'There is nothing to say.');
    if (text.length > maxChars)
      throw new HttpFail(413, 'That is too long to read aloud. It stays on screen.');

    const key = await deps.key();
    if (!key) throw new HttpFail(503, MSG_NO_KEY);
    if (key !== lastKey) {
      lastKey = key;
      deps.onKey?.(key);
    }
    await deps.assertBudget?.();

    if (inFlight >= VOICE_MAX_IN_FLIGHT)
      throw new HttpFail(429, 'Remy is still reading the last part. Try again in a moment.');
    inFlight += 1;
    try {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            model,
          },
          body: JSON.stringify({
            text,
            reference_id: deps.voiceId(),
            format: 'mp3',
            latency: 'balanced',
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const timedOut =
          e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw new HttpFail(
          timedOut ? 504 : 502,
          timedOut
            ? 'The voice service took too long to answer.'
            : 'The voice service could not be reached.',
        );
      }
      if (!res.ok) {
        // Fish's own message is not passed on: it is not written for this person and could echo input.
        if (res.status === 401 || res.status === 403)
          throw new HttpFail(502, 'The voice key was refused. Check it, then try again.');
        if (res.status === 402) throw new HttpFail(402, 'The voice account has no credit left.');
        throw new HttpFail(502, 'The voice service could not make that audio.');
      }
      let audio: Buffer;
      try {
        audio = Buffer.from(await res.arrayBuffer());
      } catch {
        throw new HttpFail(502, 'The voice service stopped before the audio finished.');
      }
      if (audio.length === 0 || audio.length > VOICE_AUDIO_MAX_BYTES)
        throw new HttpFail(502, 'The voice service sent audio that could not be used.');
      const bytes = Buffer.byteLength(text, 'utf8');
      deps.ledger?.record(bytes, ((PRICE_PER_MILLION_BYTES[model] ?? 15) * bytes) / 1_000_000);
      return {
        status: 200,
        body: audio,
        headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) },
      };
    } finally {
      inFlight -= 1;
    }
  });
}

// The settings the web app saves: trust, budget, memory, quiet hours and notifications. They live
// in REMY_HOME/web-prefs.json (0600, written atomically), apart from preferences.json, which the
// terminal changes. Only the keys below can be set; the file only holds what the person chose, so
// an unset trust falls back to the terminal's. Trust and the per-task stop apply to new tasks.
// Nothing here returns a key or a token.
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { EventStore, TaskConfig, TrustLevel } from '@remy/core';
import { fold } from '@remy/core';
import { z } from 'zod';
import { type Currency, formatMoney, isCurrencyCode, symbolOf, USD } from './currency.ts';
import { type ApiCtx, type ApiResult, type ApiRoute, HttpError } from './serve.ts';
import { DEFAULT_VOICE_ID, VOICE_ID_RE } from './serve-voice.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM, 'Use HH:MM, for example 07:30.');
const money = (max: number) => z.number().finite().min(0.01).max(max);

export const MONTHLY_CAP_MAX = 100_000;
export const PER_TASK_MAX = 10_000;

/** What PUT /api/settings accepts: any of these, nothing else. */
export const prefsPatch = z
  .object({
    trust: z.enum(['ask', 'steady', 'away']),
    budget: z
      .object({ monthly: money(MONTHLY_CAP_MAX), perTask: money(PER_TASK_MAX) })
      .partial()
      .strict(),
    remember: z.boolean(),
    quiet: z.boolean(),
    quietHours: z.object({ from: hhmm, to: hhmm }).partial().strict(),
    notifications: z
      .object({
        approvals: z.boolean(),
        finished: z.boolean(),
        noticed: z.boolean(),
        reviewAt: hhmm,
      })
      .partial()
      .strict(),
    /** What amounts are shown in. Stored amounts stay in US dollars. */
    currency: z
      .object({
        code: z.string().refine(isCurrencyCode, 'Use a three-letter code such as USD or GBP.'),
        perUsd: z.number().finite().min(0.000001).max(1_000_000),
      })
      .partial()
      .strict(),
    /** The voice Remy speaks with: a Fish Audio voice model id. */
    voice: z
      .object({
        id: z
          .string()
          .regex(VOICE_ID_RE, 'Use the voice model id from fish.audio: letters and digits.'),
      })
      .partial()
      .strict(),
    /** The one folder Remy may use for every web task; null goes back to a new empty folder each. */
    workspace: z.string().min(1).max(4096).nullable(),
    /** The app is dark only. */
    appearance: z.literal('dark'),
  })
  .partial()
  .strict();
export type PrefsPatch = z.infer<typeof prefsPatch>;

/** Every setting with a value. */
export interface WebPrefs {
  trust: TrustLevel;
  budget: { monthly: number; perTask: number };
  currency: Currency;
  remember: boolean;
  quiet: boolean;
  quietHours: { from: string; to: string };
  notifications: { approvals: boolean; finished: boolean; noticed: boolean; reviewAt: string };
  voice: { id: string };
  /** The folder every web task works in, or null for a new empty folder per task. */
  workspace: string | null;
  appearance: 'dark';
}

export const WEB_PREFS_DEFAULTS: WebPrefs = {
  trust: 'ask',
  budget: { monthly: 25, perTask: 2 },
  currency: USD,
  remember: true,
  quiet: false,
  quietHours: { from: '23:00', to: '07:00' },
  notifications: { approvals: true, finished: true, noticed: false, reviewAt: '07:30' },
  voice: { id: DEFAULT_VOICE_ID },
  workspace: null,
  appearance: 'dark',
};

export interface WebPrefsStore {
  /** Every setting, with defaults for what was never set. */
  get(): WebPrefs;
  /** Only what the person chose in the web app. */
  chosen(): PrefsPatch;
  /** Merges a checked patch and returns the result. Throws when the file cannot be written. */
  update(patch: PrefsPatch): WebPrefs;
}

const merge = (a: PrefsPatch, b: PrefsPatch): PrefsPatch => ({
  ...a,
  ...b,
  ...(a.budget || b.budget ? { budget: { ...a.budget, ...b.budget } } : {}),
  ...(a.currency || b.currency ? { currency: { ...a.currency, ...b.currency } } : {}),
  ...(a.quietHours || b.quietHours ? { quietHours: { ...a.quietHours, ...b.quietHours } } : {}),
  ...(a.notifications || b.notifications
    ? { notifications: { ...a.notifications, ...b.notifications } }
    : {}),
  ...(a.voice || b.voice ? { voice: { ...a.voice, ...b.voice } } : {}),
});

export type WorkspaceSource = 'flag' | 'setting' | 'task';

/**
 * Which folder a new task works in: the one `remy serve --workspace` was given, else the one saved
 * in Settings, else `perTask` (a new empty folder for each task).
 */
export function chooseWorkspace(
  flag: string | undefined,
  pref: string | null | undefined,
  perTask: string,
): { folder: string; source: WorkspaceSource } {
  if (flag) return { folder: flag, source: 'flag' };
  if (pref) return { folder: pref, source: 'setting' };
  return { folder: perTask, source: 'task' };
}

const inside = (root: string, p: string) => {
  const rel = relative(root, p);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};
const real = (p: string): string | undefined => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

/**
 * Checks a folder the person typed and returns the real path to store. Throws an HttpError 400
 * with a plain sentence when the folder is not one Remy should be given: it must be an absolute
 * path (a leading ~ is the home folder) to a folder that exists, not the root of the disk, not the
 * home folder itself, and not Remy's own data folder or any folder that contains it (keys live there).
 */
export function checkWorkspace(input: string, home: string, userHome: string = homedir()): string {
  const text = input.trim();
  const expanded =
    text === '~' ? userHome : text.startsWith('~/') ? join(userHome, text.slice(2)) : text;
  if (!isAbsolute(expanded))
    throw new HttpError(
      400,
      'Type the full path of the folder, starting with / or ~, for example ~/Documents/Projects.',
    );
  let isDir = false;
  try {
    isDir = statSync(expanded).isDirectory();
  } catch {
    throw new HttpError(400, 'That folder does not exist.');
  }
  if (!isDir) throw new HttpError(400, 'That is a file, not a folder.');
  const path = real(resolve(expanded));
  if (!path) throw new HttpError(400, 'That folder does not exist.');
  if (path === resolve(path, '..'))
    throw new HttpError(400, 'Pick one folder, not the whole disk.');
  const hereHome = real(userHome) ?? resolve(userHome);
  if (path === hereHome)
    throw new HttpError(400, 'Pick a folder inside your home folder, not the whole home folder.');
  const remyHome = real(home) ?? resolve(home);
  if (inside(remyHome, path) || inside(path, remyHome))
    throw new HttpError(
      400,
      "That folder holds Remy's own data and keys. Pick a different folder, such as one in Documents.",
    );
  return path;
}

/** `fallbackTrust` is the terminal's saved level, used until the web app sets one. */
export function openWebPrefs(
  home: string,
  fallbackTrust: () => TrustLevel | undefined = () => undefined,
): WebPrefsStore {
  const file = join(home, 'web-prefs.json');
  const chosen = (): PrefsPatch => {
    try {
      const parsed = prefsPatch.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data : {}; // a damaged or foreign file means defaults
    } catch {
      return {};
    }
  };
  const resolve = (c: PrefsPatch): WebPrefs => {
    const d = WEB_PREFS_DEFAULTS;
    return {
      trust: c.trust ?? fallbackTrust() ?? d.trust,
      budget: { ...d.budget, ...c.budget },
      currency: { ...d.currency, ...c.currency },
      remember: c.remember ?? d.remember,
      quiet: c.quiet ?? d.quiet,
      quietHours: { ...d.quietHours, ...c.quietHours },
      notifications: { ...d.notifications, ...c.notifications },
      voice: { ...d.voice, ...c.voice },
      workspace: c.workspace ?? null,
      appearance: 'dark',
    };
  };
  return {
    get: () => resolve(chosen()),
    chosen,
    update(patch) {
      const next = merge(chosen(), patch);
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
      return resolve(next);
    },
  };
}

/**
 * The config a new task starts with. A trust level in the request wins, then the one chosen in the
 * web app, then the terminal's (already in `base`). The cost stop is the per-task one, never more
 * than the monthly cap.
 */
export function configWithPrefs(
  base: TaskConfig,
  chosen: PrefsPatch,
  requested?: TrustLevel,
): TaskConfig {
  const trust = requested ?? chosen.trust;
  let permissions = base.permissions;
  if (trust) {
    const { trust: _old, ...rest } = base.permissions;
    permissions = trust === 'ask' ? rest : { ...rest, trust };
  }
  let maxCostUsd = chosen.budget?.perTask ?? base.budget.maxCostUsd;
  if (chosen.budget?.monthly !== undefined)
    maxCostUsd = Math.min(maxCostUsd, chosen.budget.monthly);
  return { ...base, permissions, budget: { ...base.budget, maxCostUsd } };
}

/**
 * Stops a task at what is left of the month (never below 0), so a running task cannot overshoot it.
 * Known limit: two tasks started at the same moment each get the full remainder, so the month can
 * still be overshot by up to one task's spend.
 */
export function capToMonthRemaining(config: TaskConfig, remainingUsd: number): TaskConfig {
  const maxCostUsd = Math.max(0, Math.min(config.budget.maxCostUsd, remainingUsd));
  return { ...config, budget: { ...config.budget, maxCostUsd } };
}

/** What is left of this month's cap in US dollars, never below 0. */
export async function monthRemaining(prefs: WebPrefsStore, spend: Spend): Promise<number> {
  return Math.max(0, prefs.get().budget.monthly - (await spend()));
}

// ---- what the Settings screen shows besides the values

export interface SettingsDeps {
  home: string;
  store: EventStore;
  prefs: WebPrefsStore;
  version: string;
  /** Provider and model in use, and its prices in USD per million tokens. */
  provider?: string | undefined;
  modelId: string;
  pricing?: { inPerMTok: number; outPerMTok: number } | undefined;
  /** The address the server listens on. */
  address: () => string;
  /** How many notes there are; null when they cannot be read. */
  notesCount: () => number | null;
  /** Providers that need a key (for the status word). */
  needsKey?: (provider: string) => boolean;
  /** Whether a voice key is saved, so Settings can say what spoken replies will use. */
  voiceReady?: () => boolean;
  /** The folder `remy serve --workspace` was given, already resolved; it beats the saved setting. */
  workspaceFlag?: string | undefined;
  /** The person's home folder, for `~` and the home-folder refusal. Defaults to the real one. */
  userHome?: string;
  now?: () => Date;
}

const SPEND_TTL_MS = 30_000;

/** Spend on models since the start of this month, from the task events. Cached for 30 s. */
export function createSpend(
  store: EventStore,
  now: () => Date = () => new Date(),
  /** Other costs this month (spoken replies), in US dollars. */
  extra: (at: Date) => number = () => 0,
) {
  let cache: { at: number; usd: number; month: string } | undefined;
  return async (): Promise<number> => {
    const t = now();
    const month = `${t.getFullYear()}-${t.getMonth()}`;
    if (cache && cache.month === month && t.getTime() - cache.at < SPEND_TTL_MS) return cache.usd;
    const start = new Date(t.getFullYear(), t.getMonth(), 1).getTime();
    let usd = 0;
    for (const s of await store.listTasks()) {
      if (new Date(s.createdAt).getTime() < start) continue;
      usd += fold(await store.read(s.taskId)).costUsd;
    }
    usd += extra(t);
    cache = { at: t.getTime(), usd, month };
    return usd;
  };
}
export type Spend = () => Promise<number>;

/** Throws when this month's spend has reached the monthly cap, so no new task starts. */
export async function assertUnderMonthlyCap(prefs: WebPrefsStore, spend: Spend): Promise<void> {
  const { budget, currency } = prefs.get();
  const used = await spend();
  if (used >= budget.monthly)
    throw new HttpError(
      402,
      `This month's budget is used up (${formatMoney(used, currency)} of ${formatMoney(budget.monthly, currency)}). Raise it in Settings to start more tasks.`,
    );
}

const perM = (n: number) =>
  n === 0 ? 'free' : `$${n < 1 ? n.toFixed(2) : n.toFixed(1)} per million tokens in`;
const NAMES: Record<string, string> = {
  ollama: 'Ollama on this machine',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  groq: 'Groq',
};

/** Which folder tasks use and why, for the Settings row. `path` is null for a new empty folder per task. */
export function workspaceView(d: Pick<SettingsDeps, 'prefs' | 'workspaceFlag'>) {
  const saved = d.prefs.get().workspace;
  const { folder, source } = chooseWorkspace(d.workspaceFlag, saved, '');
  return { path: source === 'task' ? null : folder, source, saved };
}

export function settingsView(d: SettingsDeps, spentMonth: number) {
  const t = (d.now ?? (() => new Date()))();
  const daysInMonth = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  const provider = d.provider ?? 'custom';
  const keyed = d.needsKey?.(provider) ?? provider !== 'ollama';
  const cost = d.pricing ? perM(d.pricing.inPerMTok) : 'price not known';
  return {
    currency: symbolOf(d.prefs.get().currency.code),
    providers: [
      {
        id: provider,
        name: NAMES[provider] ?? provider,
        note: `Using ${d.modelId}.`,
        state: keyed ? 'key_in_use' : 'running',
      },
    ],
    models: { everyday: d.modelId, hard: d.modelId, everydayCost: cost, hardCost: cost },
    budget: { usedMonth: Math.round(spentMonth * 100) / 100, daysLeft: daysInMonth - t.getDate() },
    notes: d.notesCount() ?? 0,
    voice: { ready: d.voiceReady?.() ?? false },
    workspace: workspaceView(d),
    server: { address: d.address(), lastSignIns: [] as { at: string; where: string }[] },
    about: {
      version: d.version,
      licences: 'Apache-2.0, with the open-source licences of what it bundles',
      dataDir: d.home,
    },
    prefs: d.prefs.get(),
  };
}

/** GET and PUT /api/settings. */
export function settingsRoutes(d: SettingsDeps, spend: Spend): ApiRoute {
  return async (ctx: ApiCtx): Promise<ApiResult | undefined> => {
    if (ctx.parts[0] !== 'settings' || ctx.parts.length !== 1) return undefined;
    if (ctx.method === 'GET') return { status: 200, body: settingsView(d, await spend()) };
    if (ctx.method === 'PUT') {
      const patch = await ctx.body(prefsPatch);
      if (patch.workspace) patch.workspace = checkWorkspace(patch.workspace, d.home, d.userHome);
      try {
        d.prefs.update(patch);
      } catch {
        throw new HttpError(500, 'The settings could not be saved.');
      }
      return { status: 200, body: settingsView(d, await spend()) };
    }
    return { status: 405, headers: { allow: 'GET, PUT' } };
  };
}

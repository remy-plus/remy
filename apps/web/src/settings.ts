// A tiny store for what the person sets in this browser. Keys are prefixed `remy.` and values are JSON.
// Storage can be blocked (private windows), so every read and write is guarded and falls back to memory.
// With a real server, the settings that `remy serve` keeps (trust, budget, memory, quiet, notifications)
// are copied in at start and written back on every change; the rest stay in this browser.
import { useCallback, useSyncExternalStore } from 'react';
import type { ServerPrefs, SettingsPatch, TrustLevel } from './api/types.ts';

export interface SettingValues {
  trust: TrustLevel;
  'budget.month': number;
  'budget.task': number;
  'currency.code': string;
  'currency.rate': number;
  memory: boolean;
  quiet: boolean;
  escalate: boolean;
  'notify.finished': boolean;
  'notify.noticed': boolean;
  'notify.review': string;
  /** The Fish Audio voice model id Remy speaks with. */
  'voice.id': string;
  'quiet.from': string;
  'quiet.to': string;
  onboarded: boolean;
  /** The dock's items, in order. Browser-local. */
  dock: string[];
  /** How the app is laid out. Browser-local. */
  layout: 'simple' | 'command';
  /** Whether Remy speaks the final answer of a finished turn. Browser-local. */
  voice: { speak: boolean };
}

/** The voice model used until another is chosen. Must match the server's default. */
export const DEFAULT_VOICE_ID = 'e13fa398a7f445a685316a3de6089ce7';

export const DEFAULTS: SettingValues = {
  trust: 'ask',
  'budget.month': 25,
  'budget.task': 2,
  'currency.code': 'USD',
  'currency.rate': 1,
  memory: true,
  quiet: false,
  escalate: true,
  'notify.finished': true,
  'notify.noticed': false,
  'notify.review': '07:30',
  'voice.id': DEFAULT_VOICE_ID,
  'quiet.from': '23:00',
  'quiet.to': '07:00',
  onboarded: false,
  dock: ['chat', 'activity', 'browser', 'brain', 'connections', 'settings'],
  layout: 'simple',
  voice: { speak: false },
};

export type SettingKey = keyof SettingValues;

const PREFIX = 'remy.';
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

const readRaw = (key: string): string | null => {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return memory.get(key) ?? null; // blocked: the in-memory copy lasts until the tab closes
  }
};

const writeRaw = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  for (const l of listeners) l();
};

const parse = <K extends SettingKey>(key: K, raw: string | null): SettingValues[K] => {
  if (raw === null) return DEFAULTS[key];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(DEFAULTS[key])) {
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? (v as SettingValues[K])
        : DEFAULTS[key];
    }
    return typeof v === typeof DEFAULTS[key] ? (v as SettingValues[K]) : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
};

export const getSetting = <K extends SettingKey>(key: K): SettingValues[K] =>
  parse(key, readRaw(key));

/** The part of a server-kept setting, as the patch PUT /api/settings takes. */
const toPatch = (key: SettingKey, v: unknown): SettingsPatch | null => {
  switch (key) {
    case 'trust':
      return { trust: v as TrustLevel };
    case 'budget.month':
      return { budget: { monthly: v as number } };
    case 'budget.task':
      return { budget: { perTask: v as number } };
    case 'currency.code':
      return { currency: { code: v as string } };
    case 'currency.rate':
      return { currency: { perUsd: v as number } };
    case 'memory':
      return { remember: v as boolean };
    case 'quiet':
      return { quiet: v as boolean };
    case 'quiet.from':
      return { quietHours: { from: v as string } };
    case 'quiet.to':
      return { quietHours: { to: v as string } };
    case 'notify.finished':
      return { notifications: { finished: v as boolean } };
    case 'notify.noticed':
      return { notifications: { noticed: v as boolean } };
    case 'notify.review':
      return { notifications: { reviewAt: v as string } };
    case 'voice.id':
      return { voice: { id: v as string } };
    default:
      return null; // `escalate`, `onboarded`, `dock` and `layout` stay in this browser
  }
};

let push: ((patch: SettingsPatch) => Promise<void>) | null = null;

/** Sends each change of a server-kept setting to `send`; null stops. Used when a real server is in use. */
export const bindServerSettings = (send: ((patch: SettingsPatch) => Promise<void>) | null) => {
  push = send;
};

/** Whether the server has the latest change. A setting that silently fails to save is a lie. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
let saveState: SaveState = 'idle';
const saveListeners = new Set<() => void>();
const setSaveState = (s: SaveState) => {
  saveState = s;
  for (const l of saveListeners) l();
};
const subscribeSave = (notify: () => void) => {
  saveListeners.add(notify);
  return () => saveListeners.delete(notify);
};

/** The state of the last write, for tests and for anything outside React. */
export const getSaveState = (): SaveState => saveState;

/** The state of the last write to the server, for the Settings screen to show. */
export const useSaveState = (): SaveState =>
  useSyncExternalStore(
    subscribeSave,
    () => saveState,
    () => 'idle' as SaveState,
  );

/** Copies the server's saved values into this browser without sending them back. */
export function applyServerPrefs(p: ServerPrefs) {
  const set = (key: SettingKey, v: unknown) => writeRaw(key, JSON.stringify(v));
  set('trust', p.trust);
  set('budget.month', p.budget.monthly);
  set('budget.task', p.budget.perTask);
  set('currency.code', p.currency.code);
  set('currency.rate', p.currency.perUsd);
  set('memory', p.remember);
  set('quiet', p.quiet);
  set('quiet.from', p.quietHours.from);
  set('quiet.to', p.quietHours.to);
  set('notify.finished', p.notifications.finished);
  set('notify.noticed', p.notifications.noticed);
  set('notify.review', p.notifications.reviewAt);
  if (p.voice) set('voice.id', p.voice.id); // an older server has no voice setting
}

export const setSetting = <K extends SettingKey>(key: K, value: SettingValues[K]) => {
  writeRaw(key, JSON.stringify(value));
  const patch = push && toPatch(key, value);
  if (!patch || !push) return;
  const send = push;
  setSaveState('saving');
  send(patch).then(
    () => setSaveState('saved'),
    () => setSaveState('failed'),
  );
};

/** Forgets one setting, so it falls back to its default. */
export const resetSetting = (key: SettingKey) => writeRaw(key, null);

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
};

/** A setting and its setter. Re-renders when it changes here or in another tab. */
export function useSetting<K extends SettingKey>(
  key: K,
): [SettingValues[K], (v: SettingValues[K]) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const set = useCallback((v: SettingValues[K]) => setSetting(key, v), [key]);
  return [parse(key, raw), set];
}

/** True until the person finishes or skips the first-run steps, or signs in to a server. */
export const isFirstVisit = () => {
  if (getSetting('onboarded')) return false;
  try {
    return !window.localStorage.getItem(`${PREFIX}token`);
  } catch {
    return true;
  }
};

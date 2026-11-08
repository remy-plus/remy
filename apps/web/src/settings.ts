// A tiny store for what the person sets in this browser. Keys are prefixed `remy.` and values are JSON.
// Storage can be blocked (private windows), so every read and write is guarded and falls back to memory.
// Mock-only for now: the server has no settings routes, so nothing here reaches `remy serve` yet.
import { useCallback, useSyncExternalStore } from 'react';
import type { TrustLevel } from './api/types.ts';

export interface SettingValues {
  trust: TrustLevel;
  'budget.month': number;
  'budget.task': number;
  memory: boolean;
  quiet: boolean;
  escalate: boolean;
  'notify.finished': boolean;
  'notify.noticed': boolean;
  'notify.review': string;
  'quiet.from': string;
  'quiet.to': string;
  onboarded: boolean;
}

export const DEFAULTS: SettingValues = {
  trust: 'ask',
  'budget.month': 20,
  'budget.task': 2,
  memory: true,
  quiet: false,
  escalate: true,
  'notify.finished': true,
  'notify.noticed': false,
  'notify.review': '07:30',
  'quiet.from': '23:00',
  'quiet.to': '07:00',
  onboarded: false,
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
    return typeof v === typeof DEFAULTS[key] ? (v as SettingValues[K]) : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
};

export const getSetting = <K extends SettingKey>(key: K): SettingValues[K] =>
  parse(key, readRaw(key));

export const setSetting = <K extends SettingKey>(key: K, value: SettingValues[K]) =>
  writeRaw(key, JSON.stringify(value));

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

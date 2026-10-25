import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Budget } from '@remy/core';

export interface FileConfig {
  profile?: string;
  model?: string;
  baseUrl?: string;
  autoApprove?: string[];
  budget?: Partial<Budget>;
  netAllow?: string[];
}

const strings = (v: unknown, name: string): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new Error(`remy.config.json: "${name}" must be a list of strings`);
  return v as string[];
};

/** Reads remy.config.json from the working directory, else from REMY_HOME. */
export function loadConfig(cwd: string, home: string): FileConfig {
  const path = [join(cwd, 'remy.config.json'), join(home, 'remy.config.json')].find(existsSync);
  if (!path) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`could not read ${path}: ${(e as Error).message}`);
  }
  const text = (k: string) => {
    const v = raw[k];
    if (v !== undefined && typeof v !== 'string') throw new Error(`${path}: "${k}" must be text`);
    return v as string | undefined;
  };
  const budget = raw.budget;
  if (budget !== undefined && (typeof budget !== 'object' || budget === null))
    throw new Error(`${path}: "budget" must be an object`);
  const out: FileConfig = {};
  const profile = text('profile');
  const model = text('model');
  const baseUrl = text('baseUrl');
  const autoApprove = strings(raw.autoApprove, 'autoApprove');
  const netAllow = strings(raw.netAllow, 'netAllow');
  if (profile) out.profile = profile;
  if (model) out.model = model;
  if (baseUrl) out.baseUrl = baseUrl;
  if (autoApprove) out.autoApprove = autoApprove;
  if (netAllow) out.netAllow = netAllow;
  if (budget) out.budget = budget as Partial<Budget>;
  return out;
}

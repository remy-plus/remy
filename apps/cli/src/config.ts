import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Budget } from '@remy/core';
import { type McpServerConfig, mcpServersSchema } from '@remy/mcp';
import {
  BOAT_SIZES,
  type BoatConfig,
  type ComputerConfig,
  type DockerConfig,
  type SshConfig,
} from '@remy/tools';

export interface FileConfig {
  profile?: string;
  model?: string;
  baseUrl?: string;
  autoApprove?: string[];
  budget?: Partial<Budget>;
  netAllow?: string[];
  /** Which service searches: browser, vm, exa, tinyfish, perplexity, tavily, linkup, serper, brave, context, searxng or off (REMY_SEARCH wins). */
  search?: string;
  /** Same shape as Claude Desktop's `mcpServers`. Wins over servers saved by `remy connect`. */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Machines Remy may run commands on: ssh ({ name, host, user, port?, keyPath? }, kind "ssh" or
   * none) or a container ({ name, kind: "docker", container? or image?, network? }).
   */
  computers?: ComputerConfig[];
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
  const search = text('search');
  const autoApprove = strings(raw.autoApprove, 'autoApprove');
  const netAllow = strings(raw.netAllow, 'netAllow');
  if (profile) out.profile = profile;
  if (model) out.model = model;
  if (baseUrl) out.baseUrl = baseUrl;
  if (search) out.search = search;
  if (autoApprove) out.autoApprove = autoApprove;
  if (netAllow) out.netAllow = netAllow;
  if (budget) out.budget = budget as Partial<Budget>;
  if (raw.mcpServers !== undefined) {
    const servers = mcpServersSchema.safeParse(raw.mcpServers);
    if (!servers.success) {
      const issue = servers.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
      throw new Error(
        `${path}: "mcpServers"${where}: ${issue?.message ?? 'not valid'}. Each server needs a command or a url.`,
      );
    }
    out.mcpServers = servers.data;
  }
  if (raw.computers !== undefined) {
    const list = raw.computers;
    const bad = (m: string) => new Error(`${path}: "computers" ${m}`);
    if (!Array.isArray(list)) throw bad('must be a list');
    out.computers = list.map((c, i): ComputerConfig => {
      const o = (c ?? {}) as Record<string, unknown>;
      const at = `entry ${i + 1}`;
      const text = (k: string, needed: boolean) => {
        if (o[k] === undefined && !needed) return undefined;
        if (typeof o[k] !== 'string') throw bad(`${at} needs "${k}" as text`);
        return o[k] as string;
      };
      if (o.kind !== undefined && o.kind !== 'ssh' && o.kind !== 'docker' && o.kind !== 'boat')
        throw bad(`${at}: "kind" must be "ssh", "docker" or "boat"`);
      text('name', true);
      if (o.kind === 'boat') {
        if (
          o.size !== undefined &&
          !(typeof o.size === 'string' && (BOAT_SIZES as readonly string[]).includes(o.size))
        )
          throw bad(`${at}: "size" must be ${BOAT_SIZES.join(', ')}`);
        if (o.idleStopSeconds !== undefined && typeof o.idleStopSeconds !== 'number')
          throw bad(`${at}: "idleStopSeconds" must be a number`);
        return o as unknown as BoatConfig;
      }
      if (o.kind === 'docker') {
        const container = text('container', false);
        const image = text('image', false);
        if ((container === undefined) === (image === undefined))
          throw bad(`${at} needs either "container" or "image", not both`);
        if (o.network !== undefined && o.network !== 'bridge' && o.network !== 'none')
          throw bad(`${at}: "network" must be "bridge" or "none"`);
        return o as unknown as DockerConfig;
      }
      text('host', true);
      text('user', true);
      if (o.port !== undefined && typeof o.port !== 'number')
        throw bad(`${at}: "port" must be a number`);
      text('keyPath', false);
      text('knownHostsPath', false);
      return o as unknown as SshConfig;
    });
  }
  return out;
}

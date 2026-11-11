// `remy serve` routes for connections (apps) and machines. What the web app's Connections,
// Add connection and Add machine screens call.
//
//   GET    /api/connections                 apps and machines, with status as text
//   GET    /api/connections/search?q=       what the official registry has, read-only
//   POST   /api/connections                 connect a catalog entry, or a URL server by address
//   DELETE /api/connections/:id             disconnect (forget) a saved server
//   POST   /api/connections/:id/permissions {permissionId, on}
//   GET    /api/catalog                     the entries that can be connected from here
//   POST   /api/machines/test | POST /api/machines | DELETE /api/machines/:name
//
// HARD RULE: nothing in a request ever becomes a command, arguments, an environment value, a
// header or a file path of an MCP server. A stolen token must not be able to run code on this
// machine, so only (a) catalog entries defined in code and (b) plain https addresses (marked
// untrusted, no credentials in them) can be added here. Anything else is refused with a pointer to
// `remy connect` in the terminal, where the person sees the exact command and says yes.
//
// Permission switches: the CLI has no "permission" concept for an app beyond its tools. So the
// switches are the server's own tool list (as reported when it started), and a switch is the
// config's per-tool `disabled` override. Nothing here is invented: an app that is not running has
// no switches, and a change applies the next time Remy starts, like every other connection change.
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isStdio, type McpServerConfig } from '@remy/mcp';
import { type Exec, isPrivateAddress, type SshConfig, sshComputer } from '@remy/tools';
import { z } from 'zod';
import { applyPlan, planFromEntry, SERVER_NAME, takenNames } from './connect-plan.ts';
import type { ConnectionRow } from './connections-view.ts';
import { CATALOG, type CatalogEntry, findCatalog } from './mcp-catalog.ts';
import { loadSaved, mergeServers, removeSaved, saveSaved } from './mcp-config.ts';
import type { McpHost } from './mcp-host.ts';
import { type RegistryApp, searchRegistry } from './mcp-registry.ts';
import type { SecretStore } from './mcp-secrets.ts';
import {
  guard,
  HttpFail,
  idOf,
  jsonBody,
  type Mount,
  methodNotAllowed,
  ok,
  rawJsonBody,
} from './serve-mount.ts';

export interface ConnectMountDeps {
  home: string;
  cwd: string;
  userHome: string;
  /** `mcpServers` of remy.config.json, read afresh on each call. */
  fromConfig(): Record<string, McpServerConfig>;
  /** What the running process knows about its servers; absent when connections are off. */
  host?: Pick<McpHost, 'list' | 'toolNames'> & Partial<Pick<McpHost, 'start'>>;
  secrets: SecretStore;
  /** `computers` of remy.config.json. */
  computers(): SshConfig[];
  /** Writes the machine list back to the config file Remy reads. */
  saveComputers(list: SshConfig[]): void;
  /** How ssh runs (tests replace it). */
  exec?: Exec;
  /** Addresses a host name points to (tests replace it). */
  resolve?(host: string): Promise<string[]>;
  /** How the app registry is read (tests replace it). */
  registryFetch?: typeof fetch;
}

const FORBIDDEN = [
  'command',
  'args',
  'env',
  'cwd',
  'path',
  'folder',
  'headers',
  'secret',
  'secrets',
  'token',
  'keyPath',
  'key',
];
export const STDIO_REFUSAL =
  'Remy will not add a command, a file path or a secret from the web app. Run remy connect in your terminal to add that, where you see the exact command first.';

const MACHINES_MAX = 20;
/** How long a registry answer is reused, so typing in the search box does not ask on every key. */
const SEARCH_TTL_MS = 60_000;
const SEARCH_MAX = 25;
/** A word for a command line the person will copy: bare when it is plain, quoted otherwise. */
const shellWord = (word: string) =>
  /^[A-Za-z0-9._/-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
const SEARCH_NOTE =
  'These come from the official registry, not from Remy. Adding one runs a command or connects an address, so it is done in your terminal, where you see the exact command first.';
const PERMISSIONS_MAX = 200;
const LEVEL_ACT = {
  id: 'act' as const,
  label: 'Act with approval',
  detail: 'Everything it can change asks you first.',
};
const UNTRUSTED =
  'Text that comes in through this app is treated as untrusted. Remy does not follow instructions found in it, and asks before acting on it.';

const permissionBody = z
  .object({ permissionId: z.string().min(1).max(200), on: z.boolean() })
  .strict();
const catalogBody = z
  .object({ catalogId: z.string().min(1).max(60), level: z.enum(['read', 'draft', 'act']) })
  .strict();
const urlBody = z
  .object({
    url: z.string().min(1).max(2000),
    name: z.string().min(1).max(40),
    allowPrivate: z.boolean().optional(),
  })
  .strict();
const machineBody = z
  .object({
    name: z.string().min(1).max(64),
    host: z.string().min(1).max(253),
    user: z.string().min(1).max(64),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

/** The same rule `sshComputer` applies: no leading "-", no spaces, letters digits . _ - only. */
function checkedMachine(m: z.infer<typeof machineBody>, connectTimeoutSec?: number, exec?: Exec) {
  const cfg: SshConfig = {
    name: m.name,
    host: m.host,
    user: m.user,
    ...(m.port !== undefined && { port: m.port }),
    ...(connectTimeoutSec !== undefined && { connectTimeoutSec }),
  };
  try {
    return { cfg, computer: sshComputer(cfg, exec) };
  } catch {
    throw new HttpFail(
      400,
      'A name, host and user can use letters, digits, dots, dashes and underscores, and cannot start with a dash.',
    );
  }
}

/** Only the host of an address: what a config may hold in its URL is never shown whole. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'a remote server';
  }
};

const PRIVATE_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i;
const looksPrivateName = (host: string) => !host.includes('.') || PRIVATE_NAME.test(host);

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true })).map((a) => a.address);

/** The words that go after "status" for a row the host reports. */
const STATUS_WORD: Record<ConnectionRow['status'], string> = {
  connected: 'connected',
  starting: 'starting',
  failed: 'failed',
  disabled: 'switched off',
  needs_signin: 'needs sign-in',
};

export function createConnectMount(deps: ConnectMountDeps): Mount {
  const exec = deps.exec;
  const resolveHost = deps.resolve ?? defaultResolve;

  const config = () => {
    try {
      return deps.fromConfig();
    } catch {
      throw new HttpFail(500, 'remy.config.json could not be read. Fix it, then try again.');
    }
  };
  const machinesOf = () => {
    try {
      return deps.computers();
    } catch {
      throw new HttpFail(500, 'remy.config.json could not be read. Fix it, then try again.');
    }
  };
  const declared = () => mergeServers(loadSaved(deps.home), config());

  /** Entries that need nothing from the person but a yes: no token, no folder. */
  const connectable = (e: CatalogEntry) => e.secrets.length === 0 && !e.folder;

  function listConnections() {
    const rows = new Map((deps.host?.list() ?? []).map((r) => [r.name, r]));
    const apps = declared().map((d) => {
      const row = rows.get(d.name);
      const entry = findCatalog(d.name);
      const raw = deps.host?.toolNames(d.name) ?? [];
      const overrides = d.config.tools ?? {};
      const status =
        row?.status === 'connected'
          ? ('connected' as const)
          : row?.status === 'needs_signin'
            ? ('needs_signin' as const)
            : ('not_connected' as const);
      const blurb =
        status === 'connected' || !row
          ? (entry?.blurb ??
            (isStdio(d.config) ? 'A server on this computer' : hostOf(d.config.url)))
          : `${STATUS_WORD[row.status]}${row.reason ? `: ${row.reason}` : ''}`;
      return {
        id: d.name,
        name: entry?.label ?? d.name,
        blurb: d.source === 'config' ? `${blurb} · set in remy.config.json` : blurb,
        status,
        ...(status === 'connected' && { statusNote: `${row?.tools ?? 0} tools` }),
        permissions: raw.slice(0, PERMISSIONS_MAX).map((tool) => ({
          id: tool,
          label: tool,
          detail: overrides[tool]?.disabled === true ? 'Switched off' : 'A tool this app offers',
          on: overrides[tool]?.disabled !== true,
        })),
        untrusted: UNTRUSTED,
      };
    });
    const machines = machinesOf().map((c) => ({
      name: c.name,
      detail: `ssh ${c.user}@${c.host}${c.port ? `:${c.port}` : ''}`,
      // Reaching a machine takes a real ssh call, so a list never makes one: "Test" does.
      status: 'unchecked' as const,
    }));
    return { apps, machines };
  }

  async function setPermission(id: string, req: Parameters<Mount>[0]['req']) {
    const b = await jsonBody(req, permissionBody);
    const d = declared().find((x) => x.name === id);
    if (!d) throw new HttpFail(404, 'There is no such app.');
    if (d.source !== 'saved')
      throw new HttpFail(409, `${id} is set in remy.config.json. Change its tools there.`);
    if (!deps.host?.toolNames(id).includes(b.permissionId))
      throw new HttpFail(404, 'This app does not offer that tool.');
    const saved = loadSaved(deps.home);
    const entry = saved.mcpServers[id] as McpServerConfig;
    const { [b.permissionId]: current, ...others } = entry.tools ?? {};
    const { disabled: _d, ...rest } = current ?? {};
    const next = b.on ? rest : { ...rest, disabled: true };
    const tools = Object.keys(next).length ? { ...others, [b.permissionId]: next } : others;
    const { tools: _t, ...without } = entry;
    saveSaved(deps.home, {
      ...saved,
      mcpServers: {
        ...saved.mcpServers,
        [id]: (Object.keys(tools).length ? { ...without, tools } : without) as McpServerConfig,
      },
    });
    return ok({ ok: true, note: 'This applies the next time Remy starts.' });
  }

  async function connect(req: Parameters<Mount>[0]['req']) {
    const raw = await rawJsonBody(req);
    if (FORBIDDEN.some((k) => k in raw)) throw new HttpFail(400, STDIO_REFUSAL);
    if ('catalogId' in raw) return connectCatalog(catalogBody.safeParse(raw));
    return connectUrl(urlBody.safeParse(raw));
  }

  async function connectCatalog(parsed: ReturnType<typeof catalogBody.safeParse>) {
    if (!parsed.success)
      throw new HttpFail(400, 'The body does not match: check the field names and types.');
    const entry = findCatalog(parsed.data.catalogId);
    if (!entry) throw new HttpFail(404, 'That app is not in the list.');
    if (!connectable(entry))
      throw new HttpFail(
        400,
        `${entry.label} needs ${entry.folder ? 'a folder' : 'a token'}. Run remy connect in your terminal to add it.`,
      );
    // The CLI has one level: every change asks first. The catalog says so, and nothing else is offered.
    if (parsed.data.level !== LEVEL_ACT.id)
      throw new HttpFail(400, 'Choose "Act with approval": it is the only level this app offers.');
    const taken = takenNames(deps.home, config());
    if (taken.has(entry.id)) throw new HttpFail(409, `${entry.label} is already connected.`);
    const plan = planFromEntry(entry, {
      taken,
      cwd: deps.cwd,
      userHome: deps.userHome,
    });
    applyPlan(plan, { home: deps.home, secrets: deps.secrets, values: {} });
    // Starting can take a while (a package may download); the person sees the status on the list.
    void deps.host?.start?.(plan.name).catch(() => {});
    return ok(
      {
        id: plan.name,
        status: plan.oauth ? 'needs_signin' : 'starting',
        ...(plan.oauth && { note: `Sign in with: remy connect auth ${plan.name}` }),
      },
      201,
    );
  }

  async function connectUrl(parsed: ReturnType<typeof urlBody.safeParse>) {
    if (!parsed.success)
      throw new HttpFail(
        400,
        'Give a catalogId and level, or a name and an https address. Anything else is added in the terminal with remy connect.',
      );
    const { url: text, name, allowPrivate } = parsed.data;
    if (!SERVER_NAME.test(name))
      throw new HttpFail(
        400,
        'A name uses letters, digits, - and _, starting with a letter or digit.',
      );
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new HttpFail(400, 'That is not a web address. It should start with https://.');
    }
    if (url.protocol !== 'https:') throw new HttpFail(400, 'The address must start with https://.');
    if (url.username || url.password || url.search || url.hash)
      throw new HttpFail(
        400,
        'Leave passwords, keys and other extras out of the address. A server that needs a key is added in the terminal with remy connect.',
      );
    if (allowPrivate !== true) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const refuse = () =>
        new HttpFail(
          400,
          'That address is on a private network or this computer. Confirm it is yours to add it anyway.',
        );
      if (looksPrivateName(host)) throw refuse();
      // A name is checked by what it points to now. A later change of address is not caught here.
      let addresses: string[];
      try {
        addresses = /^[\d.]+$|:/.test(host) ? [host] : await resolveHost(host);
      } catch {
        throw new HttpFail(400, 'Remy could not find that address.');
      }
      if (!addresses.length || addresses.some((a) => isPrivateAddress(a))) throw refuse();
    }
    const taken = takenNames(deps.home, config());
    if (taken.has(name)) throw new HttpFail(409, `There is already a server named ${name}.`);
    // Hints are not believed (no trustHints), so every tool of it is treated as acting for you.
    const saved = loadSaved(deps.home);
    saveSaved(deps.home, {
      ...saved,
      mcpServers: { ...saved.mcpServers, [name]: { url: url.toString() } },
    });
    void deps.host?.start?.(name).catch(() => {});
    return ok({ id: name, status: 'starting' }, 201);
  }

  function disconnect(id: string) {
    const d = declared().find((x) => x.name === id);
    if (!d) throw new HttpFail(404, 'There is no such app.');
    if (d.source !== 'saved')
      throw new HttpFail(409, `${id} is set in remy.config.json. Remove it there.`);
    removeSaved(deps.home, id, deps.secrets, config());
    return ok();
  }

  async function testMachine(req: Parameters<Mount>[0]['req']) {
    const m = await jsonBody(req, machineBody);
    const { computer } = checkedMachine(m, 10, exec);
    const target = `${m.user}@${m.host}`;
    const r = await computer.run('true', { timeoutMs: 15_000 });
    if (r.exitCode === 0 && !('timedOut' in r && r.timedOut))
      return ok({
        ok: true,
        lines: [`Connected to ${target}.`, 'The key and the host check passed.'],
      });
    const lines: string[] =
      'timedOut' in r && r.timedOut
        ? [`${target} did not answer in time.`]
        : r.stderr
            .split('\n')
            .map((l) => l.trim().slice(0, 200))
            .filter(Boolean)
            .slice(0, 3);
    if (/host key verification failed/i.test(r.stderr))
      lines.push(`Add it to your known hosts first: run ssh ${target} once in your terminal.`);
    return ok({ ok: false, lines: lines.length ? lines : [`Could not connect to ${target}.`] });
  }

  async function addMachine(req: Parameters<Mount>[0]['req']) {
    const m = await jsonBody(req, machineBody);
    const { cfg } = checkedMachine(m);
    const list = machinesOf();
    if (list.some((c) => c.name === cfg.name))
      throw new HttpFail(409, `There is already a machine named ${cfg.name}.`);
    if (list.length >= MACHINES_MAX)
      throw new HttpFail(400, 'That is as many machines as Remy keeps.');
    // No key path is taken from the request: ssh uses the keys of this computer's own account.
    deps.saveComputers([...list, cfg]);
    return ok({ name: cfg.name, note: 'Remy can use it the next time it starts.' }, 201);
  }

  /** Answers already fetched, so typing in the search box does not ask the registry each key. */
  const searched = new Map<string, { at: number; apps: RegistryApp[] }>();

  /** A registry record as the web app shows it: what it is, and the exact command that adds it. */
  const searchRow = (a: RegistryApp) => ({
    name: a.name,
    title: a.title,
    description: a.description,
    version: a.version,
    kind: a.kind,
    where: a.kind === 'remote' ? (a.url ?? '') : [a.command, ...(a.args ?? [])].join(' '),
    command: `remy connect --registry ${shellWord(a.name)}`,
  });

  /**
   * GET /api/connections/search?q= — what the official registry has. Read-only: it never adds
   * anything, and the answer only ever names a command for the person to run themselves.
   */
  async function searchApps(url: URL) {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (!q) throw new HttpFail(400, 'Type what to look for.');
    const key = q.toLowerCase();
    const hit = searched.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS)
      return ok({ apps: hit.apps.map(searchRow), note: SEARCH_NOTE });
    let apps: RegistryApp[];
    try {
      apps = await searchRegistry(q, {
        limit: SEARCH_MAX,
        ...(deps.registryFetch && { fetch: deps.registryFetch }),
      });
    } catch (e) {
      throw new HttpFail(
        502,
        e instanceof Error ? e.message : 'The app registry could not be reached.',
      );
    }
    searched.set(key, { at: Date.now(), apps });
    if (searched.size > 50) searched.delete(searched.keys().next().value as string);
    return ok({ apps: apps.map(searchRow), note: SEARCH_NOTE });
  }

  function removeMachine(name: string) {
    const list = machinesOf();
    if (!list.some((c) => c.name === name)) throw new HttpFail(404, 'There is no such machine.');
    deps.saveComputers(list.filter((c) => c.name !== name));
    return ok();
  }

  return guard(async ({ req, method, parts, url }) => {
    const [head, id, action] = parts;
    if (head === 'catalog' && parts.length === 1) {
      if (method !== 'GET') return methodNotAllowed('GET');
      return ok({
        apps: CATALOG.filter(connectable).map((e) => ({
          id: e.id,
          name: e.label,
          blurb: e.blurb,
          levels: [LEVEL_ACT],
        })),
      });
    }
    if (head === 'connections') {
      if (parts.length === 1) {
        if (method === 'GET') return ok(listConnections());
        if (method === 'POST') return await connect(req);
        return methodNotAllowed('GET', 'POST');
      }
      if (parts.length === 2 && id === 'search') {
        if (method !== 'GET') return methodNotAllowed('GET');
        return await searchApps(url);
      }
      if (parts.length === 2) {
        if (method !== 'DELETE') return methodNotAllowed('DELETE');
        return disconnect(idOf(id));
      }
      if (parts.length === 3 && action === 'permissions') {
        if (method !== 'POST') return methodNotAllowed('POST');
        return await setPermission(idOf(id), req);
      }
      return undefined;
    }
    if (head === 'machines') {
      if (parts.length === 1) {
        if (method !== 'POST') return methodNotAllowed('POST');
        return await addMachine(req);
      }
      if (parts.length === 2) {
        if (id === 'test' && method === 'POST') return await testMachine(req);
        if (method !== 'DELETE') return methodNotAllowed('DELETE');
        return removeMachine(idOf(id));
      }
    }
    return undefined;
  });
}

/** Writes `computers` into the config file, keeping every other key, atomically. */
export function writeComputers(path: string, list: SshConfig[]): void {
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new HttpFail(500, 'remy.config.json could not be read. Fix it, then try again.');
    }
  }
  const next = { ...current, computers: list };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

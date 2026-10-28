// Connected servers for one Remy process: starts them, puts their tools in the registries, reports
// failures quietly and closes everything on exit.
//
// Startup never waits on a slow server for long. Every server connects on its own, all at once, and
// `ready` settles when they are all done or `budgetMs` has passed, whichever comes first. A server
// still starting after that keeps going: its tools join every attached registry the moment they are
// listed, so they are there on the next model step. A server that fails produces one note; the rest
// are unaffected. Secrets are filled in here and registered with the redactor; nothing that leaves
// this file (notes, debug records) carries one.
import type { Tool, ToolRegistry } from '@remy/core';
import { isStdio, type McpConnectionOptions, McpManager, type McpServerConfig } from '@remy/mcp';
import type { ConnectionRow, ConnectionsApi } from './connections-view.ts';
import {
  type DeclaredServer,
  loadSaved,
  mergeServers,
  removeSaved,
  resolveServers,
  saveSaved,
} from './mcp-config.ts';
import type { SecretStore } from './mcp-secrets.ts';

/** How long startup waits for servers before carrying on without the slow ones. */
export const MCP_START_BUDGET_MS = 3_000;

/** How long closing waits for servers to say goodbye. */
const CLOSE_WAIT_MS = 1_500;

export interface McpHostDeps {
  home: string;
  /** `mcpServers` from remy.config.json. */
  fromConfig?: Record<string, McpServerConfig> | undefined;
  secrets: SecretStore;
  /** Scrubs secrets out of any text before it is shown or logged. */
  redact: (text: string) => string;
  /** Registers a secret value with the redactor. */
  addSecret: (name: string, value: string) => void;
  /** Replaces the transports (tests). */
  options?: (name: string) => McpConnectionOptions;
  budgetMs?: number;
  /** Debug records: the end of a failed local server's stderr, already redacted. */
  debug?: (event: string, data: unknown) => void;
}

export interface McpHost extends ConnectionsApi {
  /** Adds the tools loaded so far, and any that load later, to this registry. */
  attach(registry: ToolRegistry): void;
  /** Settles when every server is up or failed, or the start budget is spent. Never rejects. */
  ready: Promise<void>;
  /** Calls `fn` with each failure note: those already seen, then future ones. */
  onNote(fn: (note: string) => void): void;
  /** Disconnects every server. Safe to call twice. */
  close(): Promise<void>;
}

type State =
  | { phase: 'starting' }
  | { phase: 'connected'; tools: Tool[] }
  | { phase: 'failed'; reason: string };

const oneLine = (s: string, max = 100) => {
  const line = s.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export function startMcp(deps: McpHostDeps): McpHost {
  const budget = deps.budgetMs ?? MCP_START_BUDGET_MS;
  const declare = (): DeclaredServer[] => mergeServers(loadSaved(deps.home), deps.fromConfig);
  const declared = declare();
  const resolved = resolveServers(declared, deps.secrets);
  for (const [name, value] of Object.entries(resolved.values)) deps.addSecret(`mcp:${name}`, value);

  const states = new Map<string, State>();
  const registries: ToolRegistry[] = [];
  const managers: McpManager[] = [];
  const notes: string[] = [];
  const listeners: ((note: string) => void)[] = [];
  /** Aborted on close, so a server still starting does not hold the exit up. */
  const stop = new AbortController();

  const note = (text: string) => {
    notes.push(text);
    for (const fn of listeners) fn(text);
  };
  const fail = (name: string, reason: string, source: DeclaredServer['source']) => {
    if (stop.signal.aborted) return; // closing: not a failure worth a note
    const short = oneLine(deps.redact(reason));
    states.set(name, { phase: 'failed', reason: short });
    const next =
      source === 'saved'
        ? `Check it with remy connect list, or remove it with remy connect remove ${name}.`
        : 'Check its entry in remy.config.json.';
    note(`Could not start ${name}: ${short}. ${next}`);
  };
  const addTo = (registry: ToolRegistry, tools: Tool[]) => {
    for (const t of tools) {
      try {
        registry.add(t);
      } catch {
        // A name already taken (or one the registry rejects) leaves that one tool out.
      }
    }
  };

  const sourceOf = (name: string) => declared.find((d) => d.name === name)?.source ?? 'saved';
  for (const { server, secret } of resolved.missing)
    fail(
      server,
      `the secret "${secret}" is not saved on this computer`,
      sourceOf(server) === 'saved' ? 'saved' : 'config',
    );

  const loads = Object.entries(resolved.servers).map(async ([name, config]) => {
    states.set(name, { phase: 'starting' });
    const manager = new McpManager({ [name]: config }, deps.options);
    managers.push(manager);
    try {
      const r = await manager.loadTools(stop.signal);
      const err = r.errors[0];
      if (err) {
        const tail = manager.connection(name).stderrTail;
        if (tail && isStdio(config))
          deps.debug?.('mcp.stderr', { server: name, tail: deps.redact(tail) });
        return fail(name, err.error, sourceOf(name));
      }
      states.set(name, { phase: 'connected', tools: r.tools });
      for (const reg of registries) addTo(reg, r.tools);
    } catch (e) {
      fail(name, e instanceof Error ? e.message : String(e), sourceOf(name));
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = loads.length
    ? new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budget);
        void Promise.allSettled(loads).then(() => {
          clearTimeout(timer);
          resolve();
        });
      })
    : Promise.resolve();

  const rows = (): ConnectionRow[] =>
    declare().map((d): ConnectionRow => {
      const st = states.get(d.name);
      const base = {
        name: d.name,
        kind: isStdio(d.config) ? ('local' as const) : ('remote' as const),
        source: d.source,
        tools: st?.phase === 'connected' ? st.tools.length : 0,
      };
      if (d.disabled)
        return {
          ...base,
          status: 'disabled',
          ...(st?.phase === 'connected' && { reason: 'still on until Remy restarts' }),
        };
      if (!st || st.phase === 'starting') return { ...base, status: 'starting' };
      if (st.phase === 'failed') return { ...base, status: 'failed', reason: st.reason };
      return { ...base, status: 'connected' };
    });

  return {
    attach(registry) {
      registries.push(registry);
      for (const st of states.values()) if (st.phase === 'connected') addTo(registry, st.tools);
    },
    ready,
    onNote(fn) {
      for (const n of notes) fn(n);
      listeners.push(fn);
    },
    list: rows,
    setEnabled(name, enabled) {
      const saved = loadSaved(deps.home);
      const without = saved.disabled.filter((n) => n !== name);
      saveSaved(deps.home, { ...saved, disabled: enabled ? without : [...without, name] });
      return `${name} is switched ${enabled ? 'on' : 'off'}. It takes effect the next time Remy starts.`;
    },
    remove(name) {
      if (!removeSaved(deps.home, name, deps.secrets, deps.fromConfig))
        return `${name} is listed in remy.config.json. Remove it there, or switch it off here.`;
      return `Removed ${name}. It stops running the next time Remy starts.`;
    },
    async close() {
      clearTimeout(timer);
      stop.abort();
      // A server that does not answer the goodbye is left behind after a moment.
      await Promise.race([
        Promise.allSettled(managers.map((m) => m.closeAll())),
        new Promise((r) => setTimeout(r, CLOSE_WAIT_MS).unref()),
      ]);
    },
  };
}

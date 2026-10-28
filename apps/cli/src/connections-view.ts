// What the /connections panel shows and does, apart from how it is drawn. Shared by the full-screen
// dialog, the minimal picker and the plain-text list.
import type { PickItem } from './picker.ts';

export type ConnectionStatus = 'connected' | 'starting' | 'failed' | 'disabled' | 'needs_signin';

export interface ConnectionRow {
  name: string;
  kind: 'local' | 'remote';
  status: ConnectionStatus;
  /** Why it failed, or what a change will do. One short line, no secrets. */
  reason?: string;
  tools: number;
  /** `config` entries live in remy.config.json and can be switched off but not removed here. */
  source: 'config' | 'saved';
}

/** What the browser sign-in tells the screen while it waits. */
export interface SignInHooks {
  signal?: AbortSignal;
  /** The sign-in link, and whether the browser was opened with it. */
  onUrl?: (url: string, opened: boolean) => void;
  noBrowser?: boolean;
}

/** What the chat needs from the connected servers. */
export interface ConnectionsApi {
  list(): ConnectionRow[];
  /** Switches a server on or off for the next start. Returns a line for the transcript. */
  setEnabled(name: string, enabled: boolean): string;
  /** Forgets a saved server and its secrets. Returns a line for the transcript. */
  remove(name: string): string;
  /** Tools of this server the user always allows (full tool names). */
  allowed?(name: string): string[];
  /** Stops allowing a tool for good. Returns a line for the transcript. */
  unallow?(tool: string): string;
  /** Signs in to a remote server in the browser. Resolves with a line for the transcript. */
  signIn?(name: string, hooks: SignInHooks): Promise<string>;
}

const WORD: Record<ConnectionStatus, string> = {
  connected: 'connected',
  starting: 'starting',
  failed: 'failed',
  disabled: 'disabled',
  needs_signin: 'needs sign-in',
};

const plural = (n: number) => `${n} tool${n === 1 ? '' : 's'}`;

export const statusLine = (r: ConnectionRow): string => {
  const parts = [WORD[r.status]];
  if (r.status === 'connected') parts.push(plural(r.tools));
  if (r.reason) parts.push(r.reason);
  return parts.join(' · ');
};

/** The server list, one row per server. */
export const connectionItems = (rows: ConnectionRow[]): PickItem[] =>
  rows.map((r) => ({
    id: r.name,
    title: r.name,
    detail: `${r.kind === 'local' ? 'local' : 'remote'} · ${statusLine(r)}`,
  }));

/** What can be done to one server. Config-file servers cannot be removed from here. */
export function connectionActions(r: ConnectionRow, allowed: string[] = []): PickItem[] {
  const on = r.status !== 'disabled';
  return [
    ...(r.status === 'needs_signin'
      ? [{ id: '#signin', title: 'Sign in', detail: 'opens your browser' }]
      : []),
    ...allowed.map((tool) => ({
      id: `#unallow:${tool}`,
      title: `Always allowed: ${tool}`,
      detail: 'Enter stops allowing it; Remy asks each time again',
    })),
    on
      ? { id: '#disable', title: 'Switch off', detail: 'takes effect the next time Remy starts' }
      : { id: '#enable', title: 'Switch on', detail: 'takes effect the next time Remy starts' },
    r.source === 'saved'
      ? { id: '#remove', title: 'Remove', detail: 'forgets the server and its saved secrets' }
      : { id: '#config', title: 'Remove', detail: 'listed in remy.config.json: edit the file' },
    { id: '#back', title: 'Back' },
  ];
}

/** The same list as plain text, for `/connections list` and the minimal screen. */
export function plainConnections(rows: ConnectionRow[]): string {
  if (!rows.length)
    return 'No connections yet. Add one with: remy connect add <name> -- <command> [args]';
  const w = Math.max(...rows.map((r) => r.name.length));
  return rows.map((r) => `${r.name.padEnd(w)}  ${statusLine(r)}`).join('\n');
}

/** What `/connect` says until the in-app flow exists. */
export const CONNECT_HELP = [
  'Connect an app or service from your terminal:',
  '  remy connect add <name> -- <command> [args]      a local server, such as npx -y <package>',
  '  remy connect add <name> --url <url>              a remote server',
  '  remy connect --import                            bring in servers from Claude Desktop or Claude Code',
  'Tokens go in with --secret KEY and stay in the Keychain. Restart Remy to use a new server.',
  'See what is connected with /connections.',
].join('\n');

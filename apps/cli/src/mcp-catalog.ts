// The short list of servers `remy connect` and /connect offer. Each entry was checked against the
// vendor's own documentation or the package registry on 2026-10-28 (the source is beside it).
// Left out because they could not be verified to work for a generic client today: Slack (its hosted
// server needs a Slack app you register yourself; no dynamic client registration), Google Workspace
// (needs your own Google Cloud project and OAuth client), Atlassian (endpoint not confirmed from
// Atlassian's pages). `trustHints` is on for these: the vendor's read-only hints are believed.
import { isAbsolute, resolve } from 'node:path';
import type { McpServerConfig } from '@remy/mcp';

export interface CatalogSecret {
  /** Becomes `${secret:<name>.<key>}` in the saved config. */
  key: string;
  label: string;
  /** Where to get it, in a sentence. */
  where: string;
}

export interface CatalogEntry {
  id: string;
  label: string;
  /** One line, outcome first. */
  blurb: string;
  /** `oauth`: sign in in the browser. `token`: paste a token. `none`: nothing to give. */
  auth: 'oauth' | 'token' | 'none';
  secrets: CatalogSecret[];
  /** Asks for a folder (the only place a local server may read and write). */
  folder?: { label: string };
  trustHints: true;
  /** Where the details below were verified. */
  source: string;
  /** The config for a server called `name`. */
  build(o: { name: string; folder?: string }): McpServerConfig;
}

const ref = (name: string, key: string) => `\${secret:${name}.${key}}`;

export const CATALOG: CatalogEntry[] = [
  {
    id: 'github',
    label: 'GitHub',
    blurb: 'Read and work with your repositories, issues and pull requests',
    auth: 'token',
    secrets: [
      {
        key: 'token',
        label: 'GitHub personal access token',
        where:
          'github.com/settings/personal-access-tokens: choose only the repositories and permissions you want Remy to have',
      },
    ],
    trustHints: true,
    // https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server
    // (remote URL and the PAT header). OAuth is offered there for specific IDEs; for a generic
    // client only the token form is documented, so that is what is used.
    source:
      'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server',
    build: ({ name }) => ({
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: `Bearer ${ref(name, 'token')}` },
      trustHints: true,
    }),
  },
  {
    id: 'notion',
    label: 'Notion',
    blurb: 'Search and edit the pages and databases you can reach',
    auth: 'oauth',
    secrets: [],
    trustHints: true,
    // https://developers.notion.com/docs/get-started-with-mcp : streamable HTTP at /mcp, OAuth.
    source: 'https://developers.notion.com/docs/get-started-with-mcp',
    build: () => ({ url: 'https://mcp.notion.com/mcp', auth: 'oauth', trustHints: true }),
  },
  {
    id: 'linear',
    label: 'Linear',
    blurb: 'Find and update issues and projects',
    auth: 'oauth',
    secrets: [],
    trustHints: true,
    // https://linear.app/docs/mcp : streamable HTTP at /mcp, OAuth 2.1 with dynamic registration.
    source: 'https://linear.app/docs/mcp',
    build: () => ({ url: 'https://mcp.linear.app/mcp', auth: 'oauth', trustHints: true }),
  },
  {
    id: 'sentry',
    label: 'Sentry',
    blurb: 'Look into errors and issues in your projects',
    auth: 'oauth',
    secrets: [],
    trustHints: true,
    // https://mcp.sentry.dev/ (linked from docs.sentry.io/product/sentry-mcp/): HTTP at /mcp, OAuth.
    source: 'https://mcp.sentry.dev/',
    build: () => ({ url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', trustHints: true }),
  },
  {
    id: 'filesystem',
    label: 'Files',
    blurb: 'Let Remy read and write inside one folder you choose',
    auth: 'none',
    secrets: [],
    folder: { label: 'Folder Remy may read and write' },
    trustHints: true,
    // npm @modelcontextprotocol/server-filesystem 2.1.0 (not deprecated): the folders it may touch
    // are its arguments.
    source: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
    build: ({ folder }) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', folder ?? '.'],
      trustHints: true,
    }),
  },
  {
    id: 'fetch',
    label: 'Web pages',
    blurb: 'Read web pages and turn them into plain text (needs uv installed)',
    auth: 'none',
    secrets: [],
    trustHints: true,
    // PyPI mcp-server-fetch 2026.10.28 by Anthropic, PBC (modelcontextprotocol/servers, src/fetch).
    // The npm name "mcp-server-fetch" is a security placeholder, so it is run with uvx.
    source: 'https://pypi.org/project/mcp-server-fetch/',
    build: () => ({ command: 'uvx', args: ['mcp-server-fetch'], trustHints: true }),
  },
  {
    id: 'memory',
    label: 'Memory',
    blurb: 'A small notebook of facts Remy can keep between conversations',
    auth: 'none',
    secrets: [],
    trustHints: true,
    // npm @modelcontextprotocol/server-memory 2.0.1 (not deprecated).
    source: 'https://www.npmjs.com/package/@modelcontextprotocol/server-memory',
    build: () => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      trustHints: true,
    }),
  },
];

export const findCatalog = (id: string): CatalogEntry | undefined =>
  CATALOG.find((e) => e.id === id);

/** `~` and relative paths made absolute, so the saved command does not depend on where Remy ran. */
export function absoluteFolder(input: string, cwd: string, home: string): string {
  const t = input.trim();
  const expanded = t === '~' ? home : t.startsWith('~/') ? `${home}/${t.slice(2)}` : t;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

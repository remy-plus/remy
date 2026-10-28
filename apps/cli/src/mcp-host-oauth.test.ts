// A remote server that needs OAuth, through the host: "needs sign-in", the sign-in, and the restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@remy/core';
import { type FakeOAuthServer, fakeOAuthServer } from '@remy/mcp/oauth-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stepConnections } from './connections-flow.ts';
import { connectionActions } from './connections-view.ts';
import { loadSaved, removeSaved, saveSaved } from './mcp-config.ts';
import { type McpHost, startMcp } from './mcp-host.ts';
import { hasOAuthTokens } from './mcp-oauth.ts';
import { openSecretStore } from './mcp-secrets.ts';

let home: string;
let server: FakeOAuthServer;
const hosts: McpHost[] = [];
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'remy-hostoauth-'));
  server = await fakeOAuthServer();
});
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await server.close();
  rmSync(home, { recursive: true, force: true });
});

const secrets = () => openSecretStore({ home, platform: 'linux' });
const browser = async (url: string) => {
  const res = await fetch(url, { redirect: 'manual' });
  const back = res.headers.get('location');
  if (back) await fetch(back).catch(() => {});
  return true;
};

function start(extra: { added?: [string, string][] } = {}) {
  const host = startMcp({
    home,
    secrets: secrets(),
    redact: (t) => t,
    addSecret: (n, v) => extra.added?.push([n, v]),
    openUrl: browser,
    budgetMs: 2_000,
    signInTimeoutMs: 3_000,
  });
  hosts.push(host);
  return host;
}

const save = (auth: boolean) =>
  saveSaved(home, {
    mcpServers: { notion: { url: server.url, ...(auth && { auth: 'oauth' as const }) } },
    disabled: [],
  });

describe('a server that needs sign-in', () => {
  it('shows "needs sign-in" without calling the server, and says what to do', async () => {
    save(true);
    const host = start();
    const notes: string[] = [];
    host.onNote((n) => notes.push(n));
    await host.ready;
    expect(host.list()).toEqual([
      expect.objectContaining({ name: 'notion', status: 'needs_signin', tools: 0 }),
    ]);
    expect(notes).toEqual([expect.stringContaining('remy connect auth notion')]);
    expect(server.registrations).toBe(0);
  });

  it('treats a bare 401 from a server with no auth setting the same way', async () => {
    save(false);
    const host = start();
    await host.ready;
    expect(host.list()[0]?.status).toBe('needs_signin');
  });

  it('offers "Sign in" first, and the panel waits for the browser, then goes back to the list', () => {
    const row = {
      name: 'notion',
      kind: 'remote' as const,
      status: 'needs_signin' as const,
      tools: 0,
      source: 'saved' as const,
    };
    expect(connectionActions(row)[0]).toMatchObject({ id: '#signin' });
    const r = stepConnections({ kind: 'actions', name: 'notion' }, '#signin', [row]);
    expect(r.stage).toEqual({ kind: 'signin', name: 'notion' });
    expect(r.effect).toEqual({ type: 'signin', name: 'notion' });
    // Other picks do nothing while waiting; Esc cancels and returns to the list.
    expect(stepConnections(r.stage, '#waiting', [row]).stage).toEqual(r.stage);
    expect(stepConnections(r.stage, 'back', [row])).toEqual({
      stage: { kind: 'list' },
      effect: { type: 'cancel_signin' },
    });
  });

  it('signs in, brings its tools up at once, and the next start needs no browser', async () => {
    save(true);
    const added: [string, string][] = [];
    const host = start({ added });
    await host.ready;
    const registry = new ToolRegistry();
    host.attach(registry);
    expect(registry.get('notion__ping')).toBeUndefined();

    const line = await host.signIn?.('notion', {});
    expect(line).toBe('Signed in to notion. 1 tool ready.');
    expect(registry.get('notion__ping')).toBeDefined();
    expect(host.list()[0]).toMatchObject({ status: 'connected', tools: 1 });
    expect(hasOAuthTokens(secrets(), 'notion')).toBe(true);
    // Tokens were handed to the redactor, under names that say what they are.
    expect(added.map(([n]) => n)).toEqual(
      expect.arrayContaining(['mcp:notion.oauth.access', 'mcp:notion.oauth.refresh']),
    );
    await host.close();

    const again = start();
    await again.ready;
    expect(again.list()[0]).toMatchObject({ status: 'connected', tools: 1 });
    expect(server.authorizeRequests).toHaveLength(1);
  });

  it('marks a saved server as OAuth when it is signed in to', async () => {
    save(false);
    const host = start();
    await host.ready;
    await host.signIn?.('notion', {});
    expect(loadSaved(home).mcpServers.notion).toMatchObject({ auth: 'oauth' });
  });

  it('a cancelled sign-in says so and leaves the server needing sign-in', async () => {
    save(true);
    const ac = new AbortController();
    const host = startMcp({
      home,
      secrets: secrets(),
      redact: (t) => t,
      addSecret: () => {},
      openUrl: async () => {
        ac.abort();
        return true;
      },
      budgetMs: 1_000,
    });
    hosts.push(host);
    await host.ready;
    expect(await host.signIn?.('notion', { signal: ac.signal })).toBe('Sign-in was cancelled.');
    expect(host.list()[0]?.status).toBe('needs_signin');
  });

  it('refreshes expired tokens at start without asking again', async () => {
    save(true);
    const first = start();
    await first.ready;
    await first.signIn?.('notion', {});
    await first.close();
    server.expireAccessTokens();
    const second = start();
    await second.ready;
    expect(second.list()[0]?.status).toBe('connected');
    expect(server.tokenRequests.map((t) => t.grant)).toContain('refresh_token');
  });

  it('asks for sign-in again when the saved sign-in no longer works', async () => {
    save(true);
    const first = start();
    await first.ready;
    await first.signIn?.('notion', {});
    await first.close();
    server.revokeEverything();
    const second = start();
    await second.ready;
    expect(second.list()[0]?.status).toBe('needs_signin');
  });

  it('removing the server deletes its tokens', async () => {
    save(true);
    const host = start();
    await host.ready;
    await host.signIn?.('notion', {});
    expect(hasOAuthTokens(secrets(), 'notion')).toBe(true);
    expect(removeSaved(home, 'notion', secrets())).toBe(true);
    expect(hasOAuthTokens(secrets(), 'notion')).toBe(false);
    expect(secrets().list()).toEqual([]);
  });
});

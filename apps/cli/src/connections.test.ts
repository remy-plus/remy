// /connections and /connect: the panel's state logic, the chat commands and the minimal panel.
import { createRuntime, DEFAULT_BUDGET, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';
import { type ChatDeps, createChat, releaseLease } from './chat.ts';
import { ChatApp } from './chat-ui.ts';
import { type Stage, stepConnections, viewOf } from './connections-flow.ts';
import {
  type ConnectionRow,
  type ConnectionsApi,
  connectionActions,
  connectionItems,
  plainConnections,
} from './connections-view.ts';
import { createTheme } from './theme.ts';

const row = (name: string, extra: Partial<ConnectionRow> = {}): ConnectionRow => ({
  name,
  kind: 'local',
  status: 'connected',
  tools: 3,
  source: 'saved',
  ...extra,
});

const rows: ConnectionRow[] = [
  row('github'),
  row('notion', { kind: 'remote', status: 'failed', reason: 'could not connect', tools: 0 }),
  row('fs', { status: 'disabled', tools: 0, source: 'config' }),
  row('slow', { status: 'starting', tools: 0 }),
];

describe('connections panel logic', () => {
  it('lists servers with status and tool count', () => {
    const items = connectionItems(rows);
    expect(items.map((i) => i.id)).toEqual(['github', 'notion', 'fs', 'slow']);
    expect(items[0]?.detail).toBe('local · connected · 3 tools');
    expect(items[1]?.detail).toBe('remote · failed · could not connect');
    expect(items[2]?.detail).toBe('local · disabled');
    expect(items[3]?.detail).toBe('local · starting');
    expect(connectionItems([row('one', { tools: 1 })])[0]?.detail).toContain('1 tool');
  });

  it('offers on or off by state, and remove only for saved servers', () => {
    expect(connectionActions(row('a')).map((a) => a.id)).toEqual(['#disable', '#remove', '#back']);
    expect(connectionActions(row('a', { status: 'disabled' }))[0]?.id).toBe('#enable');
    expect(connectionActions(row('a', { source: 'config' }))[1]?.id).toBe('#config');
  });

  it('walks list, actions, confirm, and back out with Esc', () => {
    let stage: Stage = { kind: 'list' };
    const step = (pick: string) => {
      const r = stepConnections(stage, pick, rows);
      stage = r.stage;
      return r.effect;
    };
    expect(step('github')).toBeUndefined();
    expect(stage).toEqual({ kind: 'actions', name: 'github' });
    expect(step('#remove')).toBeUndefined();
    expect(stage).toEqual({ kind: 'confirm', name: 'github' });
    expect(step('#no')).toBeUndefined();
    expect(stage).toEqual({ kind: 'list' });
    step('github');
    step('#remove');
    expect(step('#yes')).toEqual({ type: 'remove', name: 'github' });
    expect(stage).toEqual({ kind: 'list' });
    step('notion');
    expect(step('back')).toBeUndefined();
    expect(stage).toEqual({ kind: 'list' });
    expect(step('back')).toEqual({ type: 'close' });
    step('fs');
    expect(step('#enable')).toEqual({ type: 'enable', name: 'fs' });
    step('github');
    expect(step('#disable')).toEqual({ type: 'disable', name: 'github' });
  });

  it('shows the confirmation before a remove', () => {
    const v = viewOf({ kind: 'confirm', name: 'github' }, rows);
    expect(v.title).toBe('Remove github?');
    expect(v.items.map((i) => i.id)).toEqual(['#yes', '#no']);
  });

  it('has a plain text list for the minimal screen', () => {
    expect(plainConnections(rows)).toContain('github  connected · 3 tools');
    expect(plainConnections([])).toContain('remy connect add');
  });
});

const answer = (text: string) => ({
  calls: [{ tool: 'finish', args: { answer: text } }],
  usage: { inTokens: 1, outTokens: 1 },
});

function api(initial: ConnectionRow[]) {
  let current = initial;
  const log: string[] = [];
  const a: ConnectionsApi = {
    list: () => current,
    setEnabled(name, on) {
      current = current.map((r) =>
        r.name === name ? { ...r, status: on ? 'connected' : 'disabled' } : r,
      );
      log.push(`${on ? 'on' : 'off'} ${name}`);
      return `${name} is switched ${on ? 'on' : 'off'}.`;
    },
    remove(name) {
      current = current.filter((r) => r.name !== name);
      log.push(`remove ${name}`);
      return `Removed ${name}.`;
    },
  };
  return { a, log };
}

function make(extra: Partial<ChatDeps> = {}) {
  const store = new MemoryEventStore();
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model: new ScriptedModelClient([answer('Done.')]),
        tools: new ToolRegistry([finish]),
        owner: 'conn',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        sleep: async () => {},
        ...hooks,
      }),
    config: (context) => ({
      model: 'test',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/tmp',
      context,
    }),
    release: releaseLease(store, 'conn'),
    model: 'm',
    ...extra,
  });
  return { chat };
}

const notes = (chat: ReturnType<typeof make>['chat']) =>
  chat
    .getState()
    .items.filter((i) => i.kind === 'note')
    .map((i) => (i as { text: string }).text);

describe('/connections and /connect in the chat', () => {
  it('opens the panel, and notes each change in the transcript', async () => {
    const { a, log } = api([row('github')]);
    const { chat } = make({ connections: a });
    await chat.submit('/connections');
    expect(chat.getState().overlay).toBe('connections');
    chat.connections().setEnabled('github', false);
    chat.connections().remove('github');
    expect(log).toEqual(['off github', 'remove github']);
    expect(notes(chat)).toEqual(['github is switched off.', 'Removed github.']);
  });

  it('prints a plain list for /connections list, and when there is nothing to open', async () => {
    const { chat } = make({ connections: api([row('github')]).a });
    await chat.submit('/connections list');
    expect(chat.getState().overlay).toBeUndefined();
    expect(notes(chat)[0]).toContain('github  connected · 3 tools');
    const empty = make({ connections: api([]).a });
    await empty.chat.submit('/connections');
    expect(empty.chat.getState().overlay).toBeUndefined();
    expect(notes(empty.chat)[0]).toContain('remy connect add');
  });

  it('/connect explains remy connect, and /help lists both commands', async () => {
    const { chat } = make();
    await chat.submit('/connect');
    expect(notes(chat)[0]).toContain('remy connect add <name> -- <command>');
    expect(notes(chat)[0]).toContain('--import');
    await chat.submit('/help');
    const help = notes(chat)[1] as string;
    expect(help).toContain('/connect ');
    expect(help).toContain('/connections');
  });

  it('holds a failure note back while the home screen shows, then shows it with the first message', async () => {
    const { chat } = make();
    chat.notify('Could not start github: nope.');
    expect(notes(chat)).toEqual([]);
    await chat.submit('hello');
    await new Promise((r) => setTimeout(r, 30));
    expect(notes(chat)).toContain('Could not start github: nope.');
    chat.notify('Could not start later: nope.');
    expect(notes(chat)).toContain('Could not start later: nope.');
  });

  it('waits for the servers (within their budget) before the first turn', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { chat } = make({ ready: () => gate });
    const sent = chat.submit('hi');
    await new Promise((r) => setTimeout(r, 30));
    expect(chat.getState().taskId).toBeUndefined();
    release();
    await sent;
    expect(chat.getState().taskId).toBeDefined();
  });
});

describe('the minimal connections panel', () => {
  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

  it('lists servers and switches one off from its action list', async () => {
    const { a, log } = api([
      row('github'),
      row('notion', { status: 'failed', reason: 'no route' }),
    ]);
    const { chat } = make({ connections: a });
    const app = render(h(ChatApp, { chat, theme: createTheme('none'), reducedMotion: true }));
    await chat.submit('/connections');
    await tick();
    const f = app.lastFrame() ?? '';
    expect(f).toContain('Connections');
    expect(f).toContain('github');
    expect(f).toContain('connected · 3 tools');
    expect(f).toContain('failed · no route');
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('Switch off');
    app.stdin.write('\r');
    await tick();
    expect(log).toEqual(['off github']);
    expect(app.lastFrame()).toContain('disabled');
    app.stdin.write('\x1b');
    await tick();
    expect(chat.getState().overlay).toBeUndefined();
    app.unmount();
  });
});

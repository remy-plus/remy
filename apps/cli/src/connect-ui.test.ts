// /connect in the chat: the picker flow (full-screen dialog and minimal), step by step.
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type ConnectPlan, planCustom, planFromEntry, suggestName } from './connect-plan.ts';
import { ConnectFlow, type ConnectFlowApi } from './connect-ui.ts';
import { CATALOG, findCatalog } from './mcp-catalog.ts';
import { createTheme } from './theme.ts';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await tick(10);
};

function fakeApi() {
  const added: { plan: ConnectPlan; values: Record<string, string> }[] = [];
  let release: (() => void) | undefined;
  const api: ConnectFlowApi = {
    choices: () =>
      CATALOG.map((e) => ({
        id: e.id,
        label: e.label,
        blurb: e.blurb,
        ...(e.folder && { folderLabel: e.folder.label }),
      })),
    prepare(a) {
      const taken = new Set(['linear']);
      if ('custom' in a) return planCustom(a.custom.input, a.custom.name, taken);
      return planFromEntry(findCatalog(a.entryId) as (typeof CATALOG)[number], {
        taken,
        cwd: '/work',
        userHome: '/Users/a',
        ...(a.folder && { folder: a.folder }),
      });
    },
    suggestName: (i) => suggestName(i, new Set()),
    defaultFolder: () => '/work',
    add: async (plan, values, hooks) => {
      added.push({ plan, values });
      if (plan.oauth)
        await new Promise<void>((r) => {
          release = r;
          hooks.signal?.addEventListener('abort', () => r());
        });
      return `Added ${plan.name}.`;
    },
  };
  return { api, added, finish: () => release?.() };
}

const mount = (api: ConnectFlowApi, dialog = false) => {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const app = render(
    h(ConnectFlow, {
      api,
      theme: createTheme('none'),
      ...(dialog && { dialog: { columns: 100, rows: 30 } }),
      onDone,
      onCancel,
    }),
  );
  return { app, onDone, onCancel };
};

/** Moves the highlight to a row by id in the minimal list and presses Enter. */
async function choose(app: ReturnType<typeof render>, id: string) {
  const at = CATALOG.findIndex((e) => e.id === id);
  for (let i = 0; i < at; i++) {
    app.stdin.write('\x1b[B');
    await tick();
  }
  app.stdin.write('\r');
  await tick();
}

describe('connect flow (minimal)', () => {
  it('lists the catalog and a custom option', () => {
    const { app } = mount(fakeApi().api);
    const frame = app.lastFrame() ?? '';
    for (const e of CATALOG) expect(frame).toContain(e.label);
    expect(frame).toContain('Custom server');
  });

  it('an OAuth entry goes straight to waiting for the browser, and Esc cancels the wait', async () => {
    const { api, added } = fakeApi();
    const { app, onDone } = mount(api);
    await choose(app, 'notion');
    await until(() => (app.lastFrame() ?? '').includes('Waiting for the browser'));
    expect(app.lastFrame()).toContain('Esc cancels');
    expect(added[0]?.plan.name).toBe('notion');
    app.stdin.write('\x1b');
    await until(() => onDone.mock.calls.length > 0);
    expect(onDone).toHaveBeenCalled();
  });

  it('a token entry says where to get it, masks it, and passes it on', async () => {
    const { api, added } = fakeApi();
    const { app, onDone } = mount(api);
    await choose(app, 'github');
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('github.com/settings/personal-access-tokens');
    app.stdin.write('ghp_FIXTURE_TOKEN');
    await until(() => (app.lastFrame() ?? '').includes('•••'));
    expect(app.lastFrame()).not.toContain('ghp_FIXTURE_TOKEN');
    app.stdin.write('\r');
    await until(() => onDone.mock.calls.length > 0);
    expect(added[0]?.values).toEqual({ token: 'ghp_FIXTURE_TOKEN' });
  });

  it('a local entry asks for the folder, shows the exact command and defaults to No', async () => {
    const { api, added } = fakeApi();
    const { app, onDone } = mount(api);
    await choose(app, 'filesystem');
    expect(app.lastFrame()).toContain('Remy can reach nothing outside it');
    app.stdin.write('\x15'); // not a clear key; clear the default by backspacing instead
    for (let i = 0; i < '/work'.length; i++) app.stdin.write('\x7f');
    await tick();
    app.stdin.write('/data/notes');
    await tick();
    app.stdin.write('\r');
    await until(() => (app.lastFrame() ?? '').includes('each time it starts'));
    expect(app.lastFrame()).toContain('npx -y @modelcontextprotocol/server-filesystem /data/notes');
    // Enter on the default (No) goes back to the list and adds nothing.
    app.stdin.write('\r');
    await tick();
    expect(added).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(app.lastFrame()).toContain('Custom server');
  });

  it('choosing Yes adds the local server', async () => {
    const { api, added } = fakeApi();
    const { app, onDone } = mount(api);
    await choose(app, 'memory');
    await until(() => (app.lastFrame() ?? '').includes('each time it starts'));
    app.stdin.write('\x1b[A');
    await tick();
    app.stdin.write('\r');
    await until(() => onDone.mock.calls.length > 0);
    expect(added[0]?.plan.name).toBe('memory');
  });

  it('shows why a choice cannot be used, and stays on the list', async () => {
    const { api, added } = fakeApi();
    const { app } = mount(api);
    await choose(app, 'linear'); // the fake marks "linear" as already connected
    expect(app.lastFrame()).toContain('already a server named linear');
    expect(added).toHaveLength(0);
  });

  it('a custom server asks for an address, then a name with a suggestion', async () => {
    const { api, added } = fakeApi();
    const { app, onDone } = mount(api);
    for (let i = 0; i < CATALOG.length; i++) {
      app.stdin.write('\x1b[B');
      await tick();
    }
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('Web address');
    app.stdin.write('https://mcp.acme.com/mcp');
    await tick();
    app.stdin.write('\r');
    await until(() => (app.lastFrame() ?? '').includes('Name for it'));
    expect(app.lastFrame()).toContain('acme');
    app.stdin.write('\r');
    await until(() => onDone.mock.calls.length > 0);
    expect(added[0]?.plan).toMatchObject({
      name: 'acme',
      config: { url: 'https://mcp.acme.com/mcp' },
    });
  });

  it('Esc on the list cancels', async () => {
    const { app, onCancel } = mount(fakeApi().api);
    app.stdin.write('\x1b');
    await tick(60);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('connect flow (dialog)', () => {
  it('searches the list and picks with Enter', async () => {
    const { api, added } = fakeApi();
    const { app } = mount(api, true);
    await tick();
    app.stdin.write('notion');
    await tick();
    app.stdin.write('\r');
    await until(() => added.length > 0);
    expect(added[0]?.plan.name).toBe('notion');
  });
});

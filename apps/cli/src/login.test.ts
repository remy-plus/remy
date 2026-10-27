import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEventStore } from '@remy/store';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CliDeps, cli } from './cli.ts';
import { openCredentials } from './credentials.ts';
import { providerChoices } from './login.ts';
import { LoginFlow, type LoginResult } from './login-ui.ts';
import { createTheme } from './theme.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'remy-login-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const SECRET = 'sk-saved-secret-0001';

interface Seen {
  url: string;
  auth: string | null;
  model: string;
}

/** A fetch that answers model listing and chat completions, and records what it was asked. */
function stubFetch(status = 200) {
  const seen: Seen[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const u = String(url);
    if (u.endsWith('/models') || u.includes('/models?')) {
      seen.push({ url: u, auth: headers.get('authorization'), model: '' });
      return new Response('{"data":[]}', { status });
    }
    const body = JSON.parse(String(init?.body)) as { model: string };
    seen.push({ url: u, auth: headers.get('authorization'), model: body.model });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                { function: { name: 'finish', arguments: JSON.stringify({ answer: 'ok' }) } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return seen;
}

function harness(extra: Partial<CliDeps> = {}) {
  const o = { out: '', err: '' };
  const deps: CliDeps = {
    env: { REMY_HOME: home },
    cwd: home,
    out: (s) => {
      o.out += s;
    },
    err: (s) => {
      o.err += s;
    },
    isTTY: false,
    store: new MemoryEventStore(),
    credentials: openCredentials({ home, platform: 'linux' }),
    ...extra,
  };
  return {
    deps,
    run: async (...argv: string[]) => {
      o.out = '';
      o.err = '';
      const code = await cli(argv, deps);
      return { code, out: o.out, err: o.err };
    },
  };
}

describe('remy login on a pipe', () => {
  it('verifies the key, saves it and never prints it', async () => {
    const seen = stubFetch();
    const h1 = harness({ readStdin: async () => `${SECRET}\n` });
    const r = await h1.run('login', 'openai', '--key-stdin', '--model', 'gpt-5-nano');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Connected openai');
    expect(r.out + r.err).not.toContain(SECRET);
    expect(seen[0]).toMatchObject({
      url: 'https://api.openai.com/v1/models',
      auth: `Bearer ${SECRET}`,
    });
    const listed = await h1.run('login', '--list');
    expect(listed.out).toContain('openai');
    expect(listed.out).toContain('gpt-5-nano');
    expect(listed.out).toContain('(default)');
    expect(listed.out).not.toContain(SECRET);
  });

  it('does not save a key the provider rejects', async () => {
    stubFetch(401);
    const h1 = harness({ readStdin: async () => 'sk-bad-key-0001' });
    const r = await h1.run('login', 'openai', '--key-stdin');
    expect(r.code).toBe(1);
    expect(r.err).toContain('not accepted');
    expect((await h1.run('login', '--list')).out).toContain('No saved logins');
  });

  it('logs out', async () => {
    stubFetch();
    const h1 = harness({ readStdin: async () => SECRET });
    await h1.run('login', 'groq', '--key-stdin');
    expect((await h1.run('logout', 'groq')).out).toContain('Forgot the groq login');
    expect((await h1.run('logout', 'groq')).out).toContain('No saved login');
  });

  it('asks for a terminal when no provider is given', async () => {
    const r = await harness().run('login');
    expect(r.code).toBe(1);
    expect(r.err).toContain('--key-stdin');
  });
});

describe('where the key and model come from', () => {
  const save = (extra: { model?: string } = {}) =>
    openCredentials({ home, platform: 'linux' }).save('openai', SECRET, extra);

  it('uses a saved login when nothing else is set, and saves a note on how to log in otherwise', async () => {
    const none = await harness().run('run', 'hi');
    expect(none.err).toContain('remy login');
    save({ model: 'gpt-5-nano' });
    const seen = stubFetch();
    const r = await harness().run('run', 'hi');
    expect(r.code).toBe(0);
    expect(seen[0]).toMatchObject({ auth: `Bearer ${SECRET}`, model: 'gpt-5-nano' });
  });

  it('env beats the saved login, flags beat env, a saved login beats remy.config.json', async () => {
    save({ model: 'saved-model' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(home, 'remy.config.json'), JSON.stringify({ model: 'config-model' }));
    const seen = stubFetch();
    await harness().run('run', 'hi');
    expect(seen.at(-1)?.model).toBe('saved-model');
    await harness({
      env: { REMY_HOME: home, REMY_MODEL: 'env-model', OPENAI_API_KEY: 'sk-from-env-0002' },
    }).run('run', 'hi');
    expect(seen.at(-1)).toMatchObject({ model: 'env-model', auth: 'Bearer sk-from-env-0002' });
    await harness({ env: { REMY_HOME: home, REMY_MODEL: 'env-model' } }).run(
      'run',
      'hi',
      '--model',
      'flag-model',
    );
    expect(seen.at(-1)?.model).toBe('flag-model');
    expect(seen.at(-1)?.auth).toBe(`Bearer ${SECRET}`);
  });

  it('keeps saved keys out of the debug log', async () => {
    save({ model: 'gpt-5-nano' });
    stubFetch();
    const log = join(home, 'debug.jsonl');
    // A model that echoes its credentials would be redacted; the request itself carries no key.
    const r = await harness({ env: { REMY_HOME: home, REMY_DEBUG: log } }).run(
      'run',
      'my key is ' + SECRET,
    );
    expect(r.code).toBe(0);
    const text = readFileSync(log, 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text).toContain('[REDACTED:openai_LOGIN_KEY]');
    expect(readdirSync(home).join()).not.toContain('debug-');
  });
});

describe('the login picker', () => {
  const tick = () => new Promise((r) => setTimeout(r, 40));

  it('lists the providers, hides the key and submits', async () => {
    const onSubmit = vi.fn(
      async (): Promise<LoginResult> => ({ ok: true, message: 'Connected openai.' }),
    );
    const onDone = vi.fn();
    const app = render(
      h(LoginFlow, {
        providers: providerChoices(),
        theme: createTheme('none'),
        onSubmit,
        onDone,
        onCancel: vi.fn(),
      }),
    );
    const first = app.lastFrame() ?? '';
    for (const word of ['OpenAI', 'OpenRouter', 'Groq', 'Custom base URL'])
      expect(first).toContain(word);
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('Paste your API key');
    app.stdin.write(SECRET);
    await tick();
    expect(app.lastFrame()).not.toContain(SECRET);
    expect(app.lastFrame()).toContain('•••');
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('Model');
    app.stdin.write('gpt-5-nano');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith({ provider: 'openai', key: SECRET, model: 'gpt-5-nano' });
    expect(app.lastFrame()).toContain('Connected openai.');
    expect(onDone).toHaveBeenCalled();
  });

  it('returns to the key question when the key is rejected, and Esc cancels', async () => {
    const onSubmit = vi.fn(
      async (): Promise<LoginResult> => ({ ok: false, message: 'That key was not accepted.' }),
    );
    const onCancel = vi.fn();
    const app = render(
      h(LoginFlow, {
        providers: providerChoices(),
        theme: createTheme('none'),
        onSubmit,
        onDone: vi.fn(),
        onCancel,
      }),
    );
    app.stdin.write('\r');
    await tick();
    app.stdin.write('sk-wrong-key-1');
    await tick();
    app.stdin.write('\r');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('That key was not accepted.');
    expect(app.lastFrame()).toContain('Paste your API key');
    app.stdin.write('\x1b');
    await tick();
    expect(onCancel).toHaveBeenCalled();
  });

  it('skips the key for Ollama and asks for a base URL for custom', async () => {
    const onSubmit = vi.fn(async (): Promise<LoginResult> => ({ ok: true, message: 'ok' }));
    const providers = providerChoices();
    const app = render(
      h(LoginFlow, {
        providers,
        theme: createTheme('none'),
        onSubmit,
        onDone: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    const ollama = providers.findIndex((p) => p.id === 'ollama');
    for (let i = 0; i < ollama; i++) app.stdin.write('\x1b[B');
    await tick();
    app.stdin.write('\r');
    await tick();
    expect(app.lastFrame()).toContain('Model');
    app.stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith({ provider: 'ollama', key: '' });

    const app2 = render(
      h(LoginFlow, {
        providers,
        theme: createTheme('none'),
        onSubmit,
        onDone: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    app2.stdin.write('\x1b[A');
    await tick();
    app2.stdin.write('\r');
    await tick();
    expect(app2.lastFrame()).toContain('Base URL');
  });
});

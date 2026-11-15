// Adding a model key from the browser: the happy path, every plain failure, and the attacks.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { ModelError } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { afterEach, describe, expect, it } from 'vitest';
import { type Credentials, openCredentials } from './credentials.ts';
import { createModelSlot, type ModelSlot } from './model-slot.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import {
  createModelSetupMount,
  explainSetupFailure,
  MSG,
  SETUP_PROVIDERS,
  setupChoices,
} from './serve-model-setup.ts';

const KEY = 'sk-test-ABCDEF1234567890abcdef';
const answer = { calls: [], text: 'ok', usage: { inTokens: 1, outTokens: 1 } };

interface Rig {
  kit: Kit;
  slot: ModelSlot;
  credentials: Credentials;
  logs: string[];
  fetched: { url: string; auth: string | null }[];
  secrets: string[];
  built: string[];
}

let open: Kit[] = [];
afterEach(async () => {
  await Promise.all(open.map((k) => k.close()));
  open = [];
});

/** A fake provider: `/models` (or `/key`) answers per `status`. */
async function rig(
  o: { status?: number | 'down'; model?: () => ScriptedModelClient; seed?: boolean } = {},
): Promise<Rig> {
  const logs: string[] = [];
  const fetched: Rig['fetched'] = [];
  const secrets: string[] = [];
  const built: string[] = [];
  const slot = createModelSlot();
  let credentials!: Credentials;
  const kit = await startKit(
    (home) => {
      credentials = openCredentials({ home, platform: 'linux' });
      return [
        createModelSetupMount({
          credentials,
          slot,
          build: (p, m, key) => {
            built.push(`${p}:${m}:${key.length}`);
            return o.model?.() ?? new ScriptedModelClient([answer], { id: m });
          },
          onKey: (k) => secrets.push(k),
          fetch: (async (url: string, init?: RequestInit) => {
            const h = new Headers(init?.headers);
            fetched.push({ url: String(url), auth: h.get('authorization') });
            if (o.status === 'down') throw new TypeError('fetch failed');
            return new Response('{}', { status: o.status ?? 200 });
          }) as typeof fetch,
        }),
      ];
    },
    { log: (l) => logs.push(l) },
  );
  open.push(kit);
  return { kit, slot, credentials, logs, fetched, secrets, built };
}

const everything = (r: Rig, text: string) => [text, ...r.logs].join('\n');

describe('GET /api/setup/model', () => {
  it('says there is no model, offers the short list cheapest first, and has no key in it', async () => {
    const r = await rig();
    const { status, json, text } = await r.kit.api('/api/setup/model');
    expect(status).toBe(200);
    expect(json.ready).toBe(false);
    expect(json.current).toBeNull();
    expect(json.choices.map((c: { id: string }) => c.id)).toEqual([...SETUP_PROVIDERS]);
    expect(json.choices[0]).toMatchObject({ id: 'openai', model: 'gpt-5-nano', needsKey: true });
    expect(text).not.toMatch(/sk-|apiKey|"key"/);
  });

  it('lists the providers by price, the cheapest first (Ollama, which is free, goes last)', async () => {
    const { BUILTIN_CATALOG } = await import('@remy/models');
    const price = (model: string) => {
      const p = BUILTIN_CATALOG[model]?.pricing;
      return p ? p.inPerMTok + p.outPerMTok : Number.POSITIVE_INFINITY;
    };
    const paid = setupChoices().filter((c) => c.needsKey);
    expect(paid.map((c) => price(c.model))).toEqual(
      paid.map((c) => price(c.model)).sort((a, b) => a - b),
    );
    expect(setupChoices().at(-1)?.id).toBe('ollama');
  });
});

describe('POST /api/setup/model: a good key', () => {
  it('checks the key, saves it privately, fills the slot and never returns the key', async () => {
    const r = await rig();
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      current: { provider: 'openai', model: 'gpt-5-nano' },
    });
    expect(res.json.saved).toMatch(/private file/);
    expect(everything(r, res.text)).not.toContain(KEY);
    // The key check went to OpenAI's own address, carrying the key as a header, not in the URL.
    expect(r.fetched).toHaveLength(1);
    expect(r.fetched[0]?.url).toBe('https://api.openai.com/v1/models');
    expect(r.fetched[0]?.auth).toBe(`Bearer ${KEY}`);
    // Saved: private file, owner only, and now the default login.
    const file = join(r.kit.home, 'credentials.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ openai: KEY });
    expect(r.credentials.defaultProvider()).toBe('openai');
    expect(r.credentials.load('openai')).toMatchObject({ key: KEY, model: 'gpt-5-nano' });
    // The key is in no other file the folder holds.
    for (const f of readdirSync(r.kit.home).filter((n) => n !== 'credentials.json'))
      expect(readFileSync(join(r.kit.home, f), 'utf8')).not.toContain(KEY);
    // In use now, with no restart.
    expect(r.slot.ready()).toBe(true);
    expect(r.slot.client.id).toBe('gpt-5-nano');
    const after = await r.kit.api('/api/setup/model');
    expect(after.json.ready).toBe(true);
    expect(after.json.current).toMatchObject({ provider: 'openai', label: 'OpenAI' });
    expect(after.text).not.toContain(KEY);
  });

  it('tells the redactor about the key before it does anything with it', async () => {
    const r = await rig({ status: 401 });
    await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(r.secrets).toEqual([KEY]); // even a key that fails the check is a secret
  });

  it('trims what was pasted', async () => {
    const r = await rig();
    const res = await r.kit.api('/api/setup/model', {
      body: { provider: 'openai', key: `  ${KEY}\n` },
    });
    expect(res.status).toBe(200);
    expect(r.credentials.load('openai')?.key).toBe(KEY);
  });

  it('needs no key for Ollama, and refuses one', async () => {
    const r = await rig();
    const bad = await r.kit.api('/api/setup/model', { body: { provider: 'ollama', key: KEY } });
    expect(bad.status).toBe(400);
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'ollama' } });
    expect(res.status).toBe(200);
    expect(r.fetched.at(-1)?.url).toBe('http://localhost:11434/v1/models');
    expect(r.fetched.at(-1)?.auth).toBeNull();
    expect(existsSync(join(r.kit.home, 'credentials.json'))).toBe(false);
  });
});

describe('POST /api/setup/model: on a Mac the key goes to the Keychain', () => {
  it('hands the key to `security` on stdin (never as an argument) and writes no file', async () => {
    const calls: { cmd: string; args: string[]; input?: string | undefined }[] = [];
    const slot = createModelSlot();
    let credentials!: Credentials;
    const kit = await startKit((home) => {
      credentials = openCredentials({
        home,
        platform: 'darwin',
        // A stub: this test never touches the real Keychain.
        exec: (cmd, args, input) => {
          calls.push({ cmd, args, input });
          return { status: 0, stdout: '' };
        },
      });
      return [
        createModelSetupMount({
          credentials,
          slot,
          build: (_p, m) => new ScriptedModelClient([answer], { id: m }),
          onKey: () => {},
          fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        }),
      ];
    });
    open.push(kit);
    const res = await kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(200);
    expect(res.json.saved).toBe('in the macOS Keychain on this computer');
    expect(res.text).not.toContain(KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('security');
    expect(calls[0]?.args).toEqual(['-i']);
    expect(calls[0]?.input).toContain(`-w ${KEY}`);
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(KEY); // never in `ps`
    expect(existsSync(join(kit.home, 'credentials.json'))).toBe(false);
    expect(readFileSync(join(kit.home, 'logins.json'), 'utf8')).not.toContain(KEY);
  });
});

describe('POST /api/setup/model: what goes wrong, in one plain sentence each', () => {
  it('a wrong key: says so, saves nothing, leaves the slot empty', async () => {
    const r = await rig({ status: 401 });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(MSG.rejected('OpenAI'));
    expect(res.json.error).toMatch(/paste it again/);
    expect(r.slot.ready()).toBe(false);
    expect(existsSync(join(r.kit.home, 'credentials.json'))).toBe(false);
    expect(existsSync(join(r.kit.home, 'logins.json'))).toBe(false);
    expect(everything(r, res.text)).not.toContain(KEY);
  });

  it('no network: says so and saves nothing', async () => {
    const r = await rig({ status: 'down' });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'anthropic', key: KEY } });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe(MSG.unreachable('Anthropic'));
    expect(res.json.error).toMatch(/internet connection/);
    expect(r.slot.ready()).toBe(false);
  });

  it('a good key on an account with no credit: says so, names where to add some, saves nothing', async () => {
    const r = await rig({
      model: () =>
        new ScriptedModelClient([
          new ModelError('HTTP 429 insufficient_quota: You exceeded your current quota', false),
        ]),
    });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(402);
    expect(res.json.error).toBe(MSG.noCredit('OpenAI', 'platform.openai.com/api-keys'));
    expect(res.json.error).toMatch(/no credit left/);
    expect(r.slot.ready()).toBe(false);
    expect(existsSync(join(r.kit.home, 'credentials.json'))).toBe(false);
    expect(everything(r, res.text)).not.toContain(KEY);
  });

  it('a model that answers with nothing still counts as working', async () => {
    const r = await rig({ model: () => new ScriptedModelClient([new Error('empty reply')]) });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(200);
  });

  it('Ollama not running: says to start it', async () => {
    const r = await rig({ status: 'down' });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'ollama' } });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe(MSG.noOllama);
  });

  it('a provider that gives a reply nobody expected never has its words passed on', async () => {
    const r = await rig({
      model: () => new ScriptedModelClient([new Error(`weird failure for key ${KEY} at /home/me`)]),
    });
    const res = await r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe(MSG.other('OpenAI'));
    expect(everything(r, res.text)).not.toContain(KEY);
    expect(res.text).not.toContain('/home/me');
  });

  it('every failure sentence is one sentence of plain words with a next step', () => {
    const c = {
      id: 'openai',
      label: 'OpenAI',
      model: 'gpt-5-nano',
      keyUrl: 'platform.openai.com',
    } as const;
    const failures = [
      new Error('HTTP 401 invalid api key'),
      new Error('HTTP 402 out of credit'),
      new Error('HTTP 404 model_not_found'),
      new Error('HTTP 429 rate limit'),
      new ModelError('fetch failed', true, { unreachable: true }),
      new Error('???'),
    ];
    for (const f of failures) {
      const s = explainSetupFailure(f, c);
      expect(s).toMatch(/[.]$/);
      expect(s).not.toMatch(/HTTP|\b[45]\d\d\b|undefined|exception|error:/i);
      expect(s).toMatch(/try again|paste it again|Add some|Try another|Wait/i);
    }
  });
});

describe('POST /api/setup/model: what is refused before anything is sent anywhere', () => {
  const refused = async (r: Rig, body: unknown, status = 400) => {
    const res = await r.kit.api('/api/setup/model', { body });
    expect(res.status).toBe(status);
    expect(r.fetched).toHaveLength(0); // nothing left this machine
    expect(r.built).toHaveLength(0);
    expect(r.slot.ready()).toBe(false);
    return res;
  };

  it('no key for a provider that needs one', async () => {
    const r = await rig();
    expect((await refused(r, { provider: 'openai' })).json.error).toBe(MSG.noKey);
    await refused(r, { provider: 'openai', key: '   ' });
  });

  it('a key with spaces, line breaks, quotes or control characters (they could break a Keychain command)', async () => {
    const r = await rig();
    for (const key of [
      'sk-abc def ghi jkl',
      `sk-abc123456\nadd-generic-password -s evil`,
      'sk-abc"123456789',
      'sk-abc\u0000123456789',
      'short',
      'é'.repeat(20),
      'k'.repeat(601),
    ]) {
      const res = await refused(r, { provider: 'openai', key });
      expect(res.json.error).toBe(
        key.length > 600
          ? 'The body does not match: check the field names and types.'
          : MSG.badShape,
      );
    }
  });

  it('an address of the caller’s choosing: the body cannot carry one', async () => {
    const r = await rig();
    await refused(r, { provider: 'openai', key: KEY, baseUrl: 'https://evil.example/v1' });
    await refused(r, { provider: 'custom', key: KEY });
    await refused(r, { provider: 'https://evil.example', key: KEY });
    await refused(r, { provider: 'zerog', key: KEY }); // on the terminal's list, not the browser's
    await refused(r, { provider: 'openai', key: KEY, extra: 1 });
    await refused(r, { provider: 7 });
    await refused(r, 'not an object');
  });

  it('a body that is not JSON', async () => {
    const r = await rig();
    const res = await r.kit.api('/api/setup/model', { raw: '{nope' });
    expect(res.status).toBe(400);
    expect(r.fetched).toHaveLength(0);
  });

  it('only GET and POST', async () => {
    const r = await rig();
    for (const method of ['PUT', 'DELETE']) {
      const res = await r.kit.api('/api/setup/model', { method });
      expect(res.status).toBe(405);
    }
  });
});

describe('POST /api/setup/model: abuse', () => {
  it('without the token it is 401, does nothing, and never hears the key', async () => {
    const r = await rig();
    for (const token of [null, 'wrong-token']) {
      const res = await r.kit.api('/api/setup/model', {
        token,
        body: { provider: 'openai', key: KEY },
      });
      expect(res.status).toBe(401);
    }
    expect(r.fetched).toHaveLength(0);
    expect(r.secrets).toHaveLength(0);
    expect(r.slot.ready()).toBe(false);
    expect(everything(r, '')).not.toContain(KEY);
    expect((await r.kit.api('/api/setup/model', { token: null })).status).toBe(401);
  });

  it('a page on another site cannot use it, even with the token', async () => {
    const r = await rig();
    const body = JSON.stringify({ provider: 'openai', key: KEY });
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://evil.example' },
      { origin: 'null' },
    ] as Record<string, string>[]) {
      const res = await fetch(`${r.kit.base}/api/setup/model`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${r.kit.token}`,
          'content-type': 'application/json',
          ...headers,
        },
        body,
      });
      expect(res.status).toBe(403);
    }
    expect(r.fetched).toHaveLength(0);
    expect(r.slot.ready()).toBe(false);
  });

  it('a name that is not this machine (DNS rebinding) gets 421', async () => {
    const r = await rig();
    const port = r.kit.serving.port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/setup/model',
          method: 'POST',
          headers: {
            host: 'evil.example',
            authorization: `Bearer ${r.kit.token}`,
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ provider: 'openai', key: KEY }));
    });
    expect(status).toBe(421);
    expect(r.fetched).toHaveLength(0);
  });

  it('is no way to guess keys: after eight tries in a minute it says to wait', async () => {
    const r = await rig({ status: 401 });
    for (let i = 0; i < 8; i++) {
      const res = await r.kit.api('/api/setup/model', {
        body: { provider: 'openai', key: `${KEY}${i}` },
      });
      expect(res.status).toBe(400);
    }
    const res = await r.kit.api('/api/setup/model', {
      body: { provider: 'openai', key: `${KEY}9` },
    });
    expect(res.status).toBe(429);
    expect(res.json.error).toBe(MSG.tooMany);
    expect(r.fetched).toHaveLength(8);
  });

  it('one check at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new ScriptedModelClient([answer], { id: 'gpt-5-nano' });
    const original = slow.complete.bind(slow);
    slow.complete = (async (...a: Parameters<typeof original>) => {
      await gate;
      return original(...a);
    }) as typeof slow.complete;
    const r = await rig({ model: () => slow });
    const first = r.kit.api('/api/setup/model', { body: { provider: 'openai', key: KEY } });
    await new Promise((x) => setTimeout(x, 100));
    const second = await r.kit.api('/api/setup/model', {
      body: { provider: 'openai', key: `${KEY}2` },
    });
    expect(second.status).toBe(429);
    expect(second.json.error).toBe(MSG.working);
    release();
    expect((await first).status).toBe(200);
  });
});

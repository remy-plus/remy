import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from './serve.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createSpend } from './serve-settings.ts';
import {
  createFishKeySource,
  createVoiceMount,
  DEFAULT_VOICE_ID,
  MSG_NO_KEY,
  openVoiceLedger,
  readFishKey,
  readFishKeyAsync,
  VOICE_TEXT_MAX,
  type VoiceMountDeps,
} from './serve-voice.ts';

const KEY = 'fish-secret-key-123';
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x01, 0x02, 0x03]);

interface Seen {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

const kits: Kit[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const k of kits.splice(0)) await k.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(
  o: { key?: string | undefined; fetch?: typeof fetch; extra?: Partial<VoiceMountDeps> } = {},
) {
  const seen: Seen[] = [];
  const fake: typeof fetch =
    o.fetch ??
    (async (url, init) => {
      seen.push({
        url: String(url),
        init: init ?? {},
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    });
  const kit = await startKit(() => [
    createVoiceMount({
      key: () => ('key' in o ? o.key : KEY),
      voiceId: () => DEFAULT_VOICE_ID,
      fetch: fake,
      ...o.extra,
    }),
  ]);
  kits.push(kit);
  const speak = (body: unknown, token: string | null = kit.token) =>
    fetch(`${kit.base}/api/voice/speak`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  return { kit, seen, speak };
}

describe('POST /api/voice/speak', () => {
  it('needs the bearer token and never calls Fish without it', async () => {
    const { seen, speak } = await start();
    expect((await speak({ text: 'Hello.' }, null)).status).toBe(401);
    expect((await speak({ text: 'Hello.' }, 'wrong')).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('sends the text to Fish with the key and the voice, and returns the audio bytes', async () => {
    const { seen, speak } = await start();
    const res = await speak({ text: '  Booked for seven.  ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(MP3);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api.fish.audio/v1/tts');
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers.model).toBe('s2.1-pro-free');
    expect(seen[0]?.body).toMatchObject({
      text: 'Booked for seven.',
      reference_id: DEFAULT_VOICE_ID,
      format: 'mp3',
    });
  });

  it('answers 503 with a plain message when there is no key, and calls nothing', async () => {
    const { seen, speak } = await start({ key: undefined });
    const res = await speak({ text: 'Hello.' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(MSG_NO_KEY);
    expect(seen).toHaveLength(0);
  });

  it('refuses empty text and text over the cap', async () => {
    const { seen, speak } = await start();
    expect((await speak({ text: '   ' })).status).toBe(400);
    expect((await speak({ text: 'a'.repeat(VOICE_TEXT_MAX + 1) })).status).toBe(413);
    expect((await speak({ text: 'a'.repeat(VOICE_TEXT_MAX) })).status).toBe(200);
    expect((await speak({ text: 'Hi.', extra: 1 })).status).toBe(400);
    expect((await speak({})).status).toBe(400);
    expect(seen).toHaveLength(1);
  });

  it('only accepts POST', async () => {
    const { kit } = await start();
    expect((await kit.api('/api/voice/speak', { method: 'GET' })).status).toBe(405);
  });

  it('turns a Fish failure into a plain message without the key or Fish text', async () => {
    for (const [status, want] of [
      [401, 502],
      [402, 402],
      [500, 502],
    ] as const) {
      const { speak } = await start({
        fetch: async () => new Response(`bad ${KEY}`, { status }),
      });
      const res = await speak({ text: 'Hello.' });
      const text = await res.text();
      expect(res.status).toBe(want);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('bad');
    }
  });

  it('answers 502 when Fish cannot be reached and 504 when it is too slow', async () => {
    const down = await start({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect((await down.speak({ text: 'Hello.' })).status).toBe(502);

    const slow = await start({
      extra: { timeoutMs: 20 },
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    const res = await slow.speak({ text: 'Hello.' });
    expect(res.status).toBe(504);
    expect(await res.text()).not.toContain(KEY);
  });

  it('refuses empty audio', async () => {
    const { speak } = await start({ fetch: async () => new Response(new Uint8Array(0)) });
    expect((await speak({ text: 'Hello.' })).status).toBe(502);
  });

  it('limits how many are in flight', async () => {
    const releases: (() => void)[] = [];
    const { speak } = await start({
      fetch: () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response(MP3)));
        }),
    });
    const first = [speak({ text: 'One.' }), speak({ text: 'Two.' }), speak({ text: 'Three.' })];
    await new Promise((r) => setTimeout(r, 100));
    expect(releases).toHaveLength(3);
    expect((await speak({ text: 'Four.' })).status).toBe(429);
    for (const r of releases) r();
    for (const p of first) expect((await p).status).toBe(200);
  });

  it('counts a call on the free model, the default, at no cost', async () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-voice-'));
    dirs.push(home);
    const ledger = openVoiceLedger(home, () => new Date(2026, 10, 10));
    const { speak } = await start({ extra: { ledger } });
    expect((await speak({ text: 'Hello there.' })).status).toBe(200);
    expect(ledger.monthUsd(new Date(2026, 10, 1))).toBe(0);
    const row = JSON.parse(readFileSync(join(home, 'voice-usage.json'), 'utf8'))['2026-11'];
    expect(row).toMatchObject({ calls: 1, bytes: 12 });
  });

  it('counts each successful call by UTF-8 byte and passes a found key on', async () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-voice-'));
    dirs.push(home);
    const ledger = openVoiceLedger(home, () => new Date(2026, 10, 10));
    const keys: string[] = [];
    const { speak } = await start({
      extra: { ledger, onKey: (k) => keys.push(k), model: 's2.1-pro' },
    });
    await speak({ text: 'Hello there.' }); // 12 bytes
    await speak({ text: 'é' }); // 2 bytes
    expect(ledger.monthUsd(new Date(2026, 10, 1))).toBeCloseTo((14 * 15) / 1_000_000, 10);
    expect(ledger.monthUsd(new Date(2026, 9, 1))).toBe(0);
    expect(keys).toEqual([KEY]); // only a changed key is passed on
    expect(statSync(join(home, 'voice-usage.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(home, 'voice-usage.json'), 'utf8')).not.toContain(KEY);
  });

  it('refuses with the budget message when the monthly cap is reached, and calls nothing', async () => {
    const { seen, speak } = await start({
      extra: {
        assertBudget: async () => {
          throw new HttpError(402, "This month's budget is used up.");
        },
      },
    });
    const res = await speak({ text: 'Hello.' });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toContain('budget');
    expect(seen).toHaveLength(0);
  });

  it('passes a changed key on again, and reads an async key', async () => {
    let key = KEY;
    const keys: string[] = [];
    const { speak } = await start({ extra: { key: async () => key, onKey: (k) => keys.push(k) } });
    await speak({ text: 'One.' });
    key = 'another-key';
    await speak({ text: 'Two.' });
    expect(keys).toEqual([KEY, 'another-key']);
  });

  it('logs a voice-usage.json that cannot be written, and still answers', async () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-voice-'));
    dirs.push(home);
    mkdirSync(join(home, 'voice-usage.json.tmp')); // a directory in the way makes the write fail
    const lines: string[] = [];
    const ledger = openVoiceLedger(home, undefined, (l) => lines.push(l));
    const { speak } = await start({ extra: { ledger } });
    expect((await speak({ text: 'Hello.' })).status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('voice-usage.json');
    expect(lines[0]).not.toContain(KEY);
  });

  it('does not count a failed call', async () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-voice-'));
    dirs.push(home);
    const ledger = openVoiceLedger(home);
    const { speak } = await start({
      extra: { ledger },
      fetch: async () => new Response('no', { status: 500 }),
    });
    await speak({ text: 'Hello.' });
    expect(ledger.monthUsd()).toBe(0);
  });
});

describe('readFishKey', () => {
  const exec = (value: string, status = 0) => {
    const calls: string[][] = [];
    return {
      calls,
      run: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status, stdout: `${value}\n` };
      },
    };
  };

  it('prefers FISH_API_KEY', () => {
    const e = exec('from-keychain');
    expect(readFishKey({ FISH_API_KEY: ' from-env ' }, 'darwin', e.run)).toBe('from-env');
    expect(e.calls).toHaveLength(0);
  });

  it('reads the macOS Keychain (service remy, account fish)', () => {
    const e = exec('from-keychain');
    expect(readFishKey({}, 'darwin', e.run)).toBe('from-keychain');
    expect(e.calls[0]).toEqual(['find-generic-password', '-s', 'remy', '-a', 'fish', '-w']);
  });

  it('finds nothing off macOS, with the keychain off, or when it holds nothing', () => {
    const e = exec('x');
    expect(readFishKey({}, 'linux', e.run)).toBeUndefined();
    expect(readFishKey({ REMY_KEYCHAIN: 'off' }, 'darwin', e.run)).toBeUndefined();
    expect(readFishKey({}, 'darwin', exec('', 44).run)).toBeUndefined();
    expect(e.calls).toHaveLength(0);
  });
});

describe('readFishKeyAsync', () => {
  it('prefers FISH_API_KEY and skips the Keychain', async () => {
    let called = 0;
    const exec = async () => {
      called += 1;
      return { status: 0, stdout: 'x\n' };
    };
    expect(await readFishKeyAsync({ FISH_API_KEY: ' k ' }, 'darwin', exec)).toBe('k');
    expect(called).toBe(0);
  });

  it('reads the Keychain with a timeout of about 2 seconds', async () => {
    const seen: { args: string[]; timeout: number }[] = [];
    const exec = async (_c: string, args: string[], timeout: number) => {
      seen.push({ args, timeout });
      return { status: 0, stdout: 'from-keychain\n' };
    };
    expect(await readFishKeyAsync({}, 'darwin', exec)).toBe('from-keychain');
    expect(seen[0]?.args).toEqual(['find-generic-password', '-s', 'remy', '-a', 'fish', '-w']);
    expect(seen[0]?.timeout).toBe(2000);
  });

  it('treats a timed-out, failed or throwing Keychain read as no key', async () => {
    expect(
      await readFishKeyAsync({}, 'darwin', async () => ({ status: null, stdout: '' })),
    ).toBeUndefined();
    expect(
      await readFishKeyAsync({}, 'darwin', async () => ({ status: 44, stdout: 'x' })),
    ).toBeUndefined();
    expect(
      await readFishKeyAsync({}, 'darwin', async () => {
        throw new Error('boom');
      }),
    ).toBeUndefined();
    expect(
      await readFishKeyAsync({}, 'linux', async () => ({ status: 0, stdout: 'x' })),
    ).toBeUndefined();
  });

  it('does not block while the Keychain is slow (a real command killed at the timeout)', async () => {
    const { realAsyncExec } = await import('./serve-voice.ts');
    const t = Date.now();
    const r = await realAsyncExec('sleep', ['5'], 100);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.status).not.toBe(0);
  });
});

describe('createFishKeySource', () => {
  it('caches, shares a lookup in flight, and refreshes after the ttl', async () => {
    let n = 0;
    let at = 0;
    const src = createFishKeySource(
      async () => `key${++n}`,
      1000,
      () => at,
    );
    expect(src.peek()).toBeUndefined(); // first peek starts a lookup
    expect(await Promise.all([src.get(), src.get()])).toEqual(['key1', 'key1']);
    expect(n).toBe(1);
    expect(src.peek()).toBe('key1');
    at = 2000;
    expect(await src.get()).toBe('key2');
  });

  it('a failing lookup means no key', async () => {
    const src = createFishKeySource(async () => {
      throw new Error('x');
    });
    expect(await src.get()).toBeUndefined();
  });
});

describe('createSpend extra', () => {
  it('passes the injected now through to the extra cost', async () => {
    const seen: Date[] = [];
    const at = new Date(2026, 10, 10);
    const spend = createSpend(
      { listTasks: async () => [] } as never,
      () => at,
      (d) => {
        seen.push(d);
        return 1.5;
      },
    );
    expect(await spend()).toBe(1.5);
    expect(seen).toEqual([at]);
  });
});

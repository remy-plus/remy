import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import {
  createVoiceMount,
  DEFAULT_VOICE_ID,
  MSG_NO_KEY,
  openVoiceLedger,
  readFishKey,
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
    expect(headers.model).toBe('s2.1-pro');
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

  it('counts each successful call by UTF-8 byte and passes a found key on', async () => {
    const home = mkdtempSync(join(tmpdir(), 'remy-voice-'));
    dirs.push(home);
    const ledger = openVoiceLedger(home, () => new Date(2026, 10, 10));
    const keys: string[] = [];
    const { speak } = await start({ extra: { ledger, onKey: (k) => keys.push(k) } });
    await speak({ text: 'Hello there.' }); // 12 bytes
    await speak({ text: 'é' }); // 2 bytes
    expect(ledger.monthUsd(new Date(2026, 10, 1))).toBeCloseTo((14 * 15) / 1_000_000, 10);
    expect(ledger.monthUsd(new Date(2026, 9, 1))).toBe(0);
    expect(keys).toEqual([KEY, KEY]);
    expect(statSync(join(home, 'voice-usage.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(home, 'voice-usage.json'), 'utf8')).not.toContain(KEY);
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

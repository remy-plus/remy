import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createSearchMount, MSG_TEST_TOO_SOON, type SearchStatusView } from './serve-search.ts';
import { openWebPrefs } from './serve-settings.ts';

const SECRET = 'exa-secret-key-999';
const STATUS: SearchStatusView = {
  chosen: 'exa',
  order: ['exa', 'browser'],
  override: null,
  services: [
    { id: 'exa', label: 'Exa', key: 'keychain', kind: 'search' },
    { id: 'tavily', label: 'Tavily', key: 'none', kind: 'search' },
    { id: 'firecrawl', label: 'Firecrawl', key: 'none', kind: 'reader', note: 'Reads pages' },
  ],
};

const kits: Kit[] = [];
afterEach(async () => {
  for (const k of kits.splice(0)) {
    await k.close();
    rmSync(k.home, { recursive: true, force: true });
  }
});

async function start(
  o: { test?: (id: string) => Promise<{ title: string }[]>; clock?: { t: number } } = {},
) {
  const clock = o.clock ?? { t: 1000 };
  const kit = await startKit((home) => [
    createSearchMount({
      prefs: openWebPrefs(home),
      searchStatus: async () => STATUS,
      testSearch: o.test ?? (async () => [{ title: 'Node.js 24' }, { title: 'Releases' }]),
      redact: (t) => t.split(SECRET).join('[key]'),
      now: () => clock.t,
    }),
  ]);
  kits.push(kit);
  return kit;
}

describe('/api/search', () => {
  it('reports the status and no saved preference', async () => {
    const kit = await start();
    const r = await kit.api('/api/search');
    expect(r.status).toBe(200);
    expect(r.json.chosen).toBe('exa');
    expect(r.json.prefer).toBeNull();
    expect(r.json.services).toHaveLength(3);
    expect(r.json.services[2].kind).toBe('reader');
  });

  it('needs the token', async () => {
    const kit = await start();
    expect((await kit.api('/api/search', { token: null })).status).toBe(401);
  });

  it('saves a preference and takes it back with auto', async () => {
    const kit = await start();
    const put = await kit.api('/api/search', { method: 'PUT', body: { prefer: 'tavily' } });
    expect(put.status).toBe(200);
    expect(put.json.prefer).toBe('tavily');
    expect((await kit.api('/api/search')).json.prefer).toBe('tavily');
    const auto = await kit.api('/api/search', { method: 'PUT', body: { prefer: 'auto' } });
    expect(auto.json.prefer).toBeNull();
  });

  it('refuses an unknown id, a reader, and extra fields', async () => {
    const kit = await start();
    for (const body of [{ prefer: 'nope' }, { prefer: 'firecrawl' }, { prefer: 'exa', key: 'x' }])
      expect((await kit.api('/api/search', { method: 'PUT', body })).status).toBe(400);
  });

  it('tests a service with a key and returns titles', async () => {
    const kit = await start();
    const r = await kit.api('/api/search/test', { method: 'POST', body: { id: 'exa' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, titles: ['Node.js 24', 'Releases'] });
    expect(typeof r.json.ms).toBe('number');
  });

  it('will not test a service with no key or an unknown one', async () => {
    const kit = await start();
    expect(
      (await kit.api('/api/search/test', { method: 'POST', body: { id: 'tavily' } })).status,
    ).toBe(400);
    expect(
      (await kit.api('/api/search/test', { method: 'POST', body: { id: 'zzz' } })).status,
    ).toBe(400);
  });

  it('allows one test per 5 seconds', async () => {
    const clock = { t: 1000 };
    const kit = await start({ clock });
    const go = () => kit.api('/api/search/test', { method: 'POST', body: { id: 'exa' } });
    expect((await go()).status).toBe(200);
    clock.t += 1000;
    const second = await go();
    expect(second.status).toBe(429);
    expect(second.json.error).toBe(MSG_TEST_TOO_SOON);
    clock.t += 5000;
    expect((await go()).status).toBe(200);
  });

  it('returns a plain error with the key removed', async () => {
    const kit = await start({
      test: async () => {
        throw new Error(`Exa rejected ${SECRET}`);
      },
    });
    const r = await kit.api('/api/search/test', { method: 'POST', body: { id: 'exa' } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toBe('Exa rejected [key]');
    expect(r.text).not.toContain(SECRET);
  });
});

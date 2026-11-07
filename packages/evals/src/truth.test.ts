import { describe, expect, it, vi } from 'vitest';
import {
  aboutDays,
  cratesInfo,
  dateForms,
  daysBetween,
  eolCycles,
  type Fetch,
  getJson,
  isMissing,
  nodeLtsLine,
  npmInfo,
  pypiInfo,
  TruthError,
} from './truth.ts';

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });
/** A fetch that answers from a table of address -> response, and records what was asked. */
const stub = (table: Record<string, () => Response>) => {
  const seen: { url: string; agent: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, agent: (init?.headers as Record<string, string>)?.['user-agent'] });
    const make = table[url];
    if (!make) return reply(404);
    return make();
  }) as unknown as Fetch;
  return { f, seen };
};

describe('dates', () => {
  it('counts whole days and ignores the time of day', () => {
    expect(daysBetween('2026-01-01T23:59:00Z', '2026-01-31T00:01:00Z')).toBe(30);
    expect(daysBetween('2026-02-01', '2026-01-01')).toBe(31);
    expect(aboutDays(30)).toEqual(['30', '29', '31']);
  });

  it('writes a date the ways an answer does', () => {
    const forms = dateForms('2028-04-05');
    expect(forms).toEqual(
      expect.arrayContaining([
        '2028-04-05',
        '5 April 2028',
        'April 5, 2028',
        'Apr 5, 2028',
        'April 05, 2028',
      ]),
    );
  });
});

describe('getJson and isMissing', () => {
  it('sends the eval user agent and reads JSON', async () => {
    const { f, seen } = stub({ 'https://a.test/x': () => reply(200, { ok: 1 }) });
    expect(await getJson('https://a.test/x', f)).toEqual({ ok: 1 });
    expect(seen[0]?.agent).toBe('remy-evals');
  });

  it('retries a busy source once, then gives up with a TruthError', async () => {
    vi.useFakeTimers();
    let n = 0;
    const flaky = (async () =>
      ++n === 1 ? reply(503) : reply(200, { ok: 1 })) as unknown as Fetch;
    const p = getJson('https://a.test/x', flaky);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: 1 });
    const down = (async () => reply(500)) as unknown as Fetch;
    const q = getJson('https://a.test/x', down).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await q).toBeInstanceOf(TruthError);
    vi.useRealTimers();
  });

  it('treats a 404 as an answer for isMissing and anything else odd as an error', async () => {
    const { f } = stub({
      'https://a.test/there': () => reply(200),
      'https://a.test/gone': () => reply(404),
    });
    expect(await isMissing('https://a.test/gone', f)).toBe(true);
    expect(await isMissing('https://a.test/there', f)).toBe(false);
    const forbidden = stub({ 'https://a.test/x': () => reply(403) }).f;
    await expect(isMissing('https://a.test/x', forbidden)).rejects.toBeInstanceOf(TruthError);
    await expect(getJson('https://a.test/gone', f)).rejects.toThrow('HTTP 404');
  });
});

describe('registries', () => {
  it('reads npm latest with its publish time', async () => {
    const { f } = stub({
      'https://registry.npmjs.org/chalk': () =>
        reply(200, { 'dist-tags': { latest: '5.0.0' }, time: { '5.0.0': '2026-01-02T03:04:05Z' } }),
      'https://registry.npmjs.org/odd': () =>
        reply(200, { 'dist-tags': { latest: '1.0.0' }, time: {} }),
    });
    expect(await npmInfo('chalk', f)).toEqual({ version: '5.0.0', at: '2026-01-02T03:04:05Z' });
    await expect(npmInfo('odd', f)).rejects.toBeInstanceOf(TruthError);
  });

  it('reads PyPI with the first upload time of the latest version', async () => {
    const { f } = stub({
      'https://pypi.org/pypi/httpx/json': () =>
        reply(200, {
          info: { version: '0.28.1', requires_python: '>=3.8' },
          urls: [
            { upload_time_iso_8601: '2024-12-06T15:37:21Z' },
            { upload_time_iso_8601: '2024-12-06T15:37:19Z' },
          ],
        }),
    });
    expect(await pypiInfo('httpx', f)).toEqual({
      version: '0.28.1',
      at: '2024-12-06T15:37:19Z',
      requiresPython: '>=3.8',
    });
  });

  it('reads crates.io for the newest stable version and its date', async () => {
    const { f } = stub({
      'https://crates.io/api/v1/crates/serde': () =>
        reply(200, {
          crate: { max_stable_version: '1.0.2' },
          versions: [
            { num: '1.0.3-rc.1', created_at: '2026-03-01T00:00:00Z' },
            { num: '1.0.2', created_at: '2026-02-01T00:00:00Z' },
          ],
        }),
    });
    expect(await cratesInfo('serde', f)).toEqual({ version: '1.0.2', at: '2026-02-01T00:00:00Z' });
  });

  it('reads endoflife.date cycles', async () => {
    const cycles = [{ cycle: '1.0', releaseDate: '2026-01-01', eol: false, latest: '1.0.1' }];
    const { f } = stub({ 'https://endoflife.date/api/x.json': () => reply(200, cycles) });
    expect(await eolCycles('x', f)).toEqual(cycles);
  });

  it('finds the newest Node LTS line from the index and the schedule', async () => {
    const { f } = stub({
      'https://nodejs.org/dist/index.json': () =>
        reply(200, [
          { version: 'v27.0.0-alpha.0', date: '2026-10-29', lts: false },
          { version: 'v24.11.1', date: '2026-10-20', lts: 'Krypton' },
          { version: 'v24.11.0', date: '2026-10-01', lts: 'Krypton' },
        ]),
      'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json': () =>
        reply(200, {
          v24: { start: '2025-05-06', lts: '2025-10-28', end: '2028-04-30', codename: 'Krypton' },
        }),
    });
    const r = await nodeLtsLine(f);
    expect(r.major).toBe('24');
    expect(r.line.end).toBe('2028-04-30');
    expect(r.newest.version).toBe('v24.11.1');
    const noLine = stub({
      'https://nodejs.org/dist/index.json': () =>
        reply(200, [{ version: 'v30.0.0', date: 'x', lts: 'Z' }]),
      'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json': () => reply(200, {}),
    }).f;
    await expect(nodeLtsLine(noLine)).rejects.toBeInstanceOf(TruthError);
  });
});

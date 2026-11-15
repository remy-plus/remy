import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchResult, ScopedFetch } from '@remy/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGeocoder, openLocation } from './location.ts';
import { type Kit, startKit } from './serve-kit.test-kit.ts';
import { createLocationMount } from './serve-location.ts';

const kits: Kit[] = [];
afterEach(async () => {
  for (const k of kits.splice(0)) await k.close();
});

const PHILLY: FetchResult = {
  url: 'x',
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    address: { city: 'Philadelphia', state: 'Pennsylvania', country_code: 'us' },
  }),
};

async function start(get?: ScopedFetch['get']) {
  const urls: string[] = [];
  const net: ScopedFetch = {
    get:
      get ??
      (async (url) => {
        urls.push(url);
        return PHILLY;
      }),
  };
  const kit = await startKit((home) => [
    createLocationMount({
      store: openLocation(home),
      geocoder: createGeocoder(net, () => 0),
      now: () => new Date('2026-11-14T12:00:00Z'),
    }),
  ]);
  kits.push(kit);
  return { kit, urls };
}

describe('the location routes', () => {
  it('need the bearer token and never reach the geocoder without it', async () => {
    const { kit, urls } = await start();
    for (const method of ['GET', 'DELETE'])
      expect((await kit.api('/api/location', { method, token: null })).status).toBe(401);
    expect(
      (await kit.api('/api/location', { method: 'PUT', body: { lat: 1, lon: 1 }, token: null }))
        .status,
    ).toBe(401);
    expect(
      (await kit.api('/api/location', { method: 'PUT', body: { lat: 1, lon: 1 }, token: 'nope' }))
        .status,
    ).toBe(401);
    expect(urls).toHaveLength(0);
  });

  it('refuse a cross-site page, even with the token, and change nothing', async () => {
    const { kit, urls } = await start();
    for (const headers of [
      { origin: 'https://evil.example' } as Record<string, string>,
      { 'sec-fetch-site': 'cross-site' } as Record<string, string>,
    ]) {
      const res = await fetch(`${kit.base}/api/location`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${kit.token}`,
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ lat: 39.95, lon: -75.16 }),
      });
      expect(res.status).toBe(403);
    }
    expect(urls).toHaveLength(0);
    expect((await kit.api('/api/location')).json).toEqual({
      place: null,
      setAt: null,
      declined: false,
    });
  });

  it('start empty', async () => {
    const { kit } = await start();
    const r = await kit.api('/api/location');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ place: null, setAt: null, declined: false });
  });

  it('turn rounded coordinates into a place, store it, and never send the coordinates back', async () => {
    const { kit, urls } = await start();
    const r = await kit.api('/api/location', {
      method: 'PUT',
      body: { lat: 39.952583, lon: -75.165222 },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      place: 'Philadelphia, Pennsylvania, US',
      setAt: '2026-11-14T12:00:00.000Z',
      declined: false,
    });
    expect(r.text).not.toContain('39.9');
    const u = new URL(urls[0] ?? '');
    expect(u.searchParams.get('lat')).toBe('39.95'); // rounded again by the server
    expect(u.searchParams.get('lon')).toBe('-75.17');
    const file = JSON.parse(readFileSync(join(kit.home, 'location.json'), 'utf8'));
    expect(file.location).toMatchObject({ lat: 39.95, lon: -75.17 });
    expect((await kit.api('/api/location')).json.place).toBe('Philadelphia, Pennsylvania, US');
  });

  it('does not ask the service again for the same rounded point', async () => {
    const { kit, urls } = await start();
    await kit.api('/api/location', { method: 'PUT', body: { lat: 39.95, lon: -75.16 } });
    await kit.api('/api/location', { method: 'PUT', body: { lat: 39.9501, lon: -75.1599 } });
    expect(urls).toHaveLength(1);
  });

  it('save the rounded point as the place when the geocoder fails', async () => {
    const { kit } = await start(async () => Promise.reject(new Error('offline')));
    const r = await kit.api('/api/location', {
      method: 'PUT',
      body: { lat: 39.952583, lon: -75.161 },
    });
    expect(r.status).toBe(200);
    expect(r.json.place).toBe('near 39.95, -75.16');
  });

  it.each([
    ['not JSON', { raw: 'lat=1' }],
    ['a missing field', { body: { lat: 39.95 } }],
    ['text for a number', { body: { lat: 'x', lon: 'y' } }],
    ['latitude out of range', { body: { lat: 91, lon: 0 } }],
    ['longitude out of range', { body: { lat: 0, lon: -181 } }],
    ['an extra field', { body: { lat: 1, lon: 1, place: 'Atlantis' } }],
  ])('refuse %s with a 400 and store nothing', async (_why, input) => {
    const { kit, urls } = await start();
    const r = await kit.api('/api/location', { method: 'PUT', ...input });
    expect(r.status).toBe(400);
    expect(urls).toHaveLength(0);
    expect((await kit.api('/api/location')).json.place).toBeNull();
  });

  it('turn off deletes the place and remembers not to ask again', async () => {
    const { kit } = await start();
    await kit.api('/api/location', { method: 'PUT', body: { lat: 39.95, lon: -75.16 } });
    const r = await kit.api('/api/location', { method: 'DELETE' });
    expect(r.json).toEqual({ place: null, setAt: null, declined: true });
    const raw = readFileSync(join(kit.home, 'location.json'), 'utf8');
    expect(raw).not.toContain('Philadelphia');
    expect(raw).not.toContain('39.95');
  });

  it('remember a refusal, but a refusal never deletes a place that was set', async () => {
    const { kit } = await start();
    expect(
      (await kit.api('/api/location/decline', { method: 'POST', body: {} })).json.declined,
    ).toBe(true);
    await kit.api('/api/location', { method: 'PUT', body: { lat: 39.95, lon: -75.16 } });
    const r = await kit.api('/api/location/decline', { method: 'POST', body: {} });
    expect(r.json.place).toBe('Philadelphia, Pennsylvania, US');
    expect(r.json.declined).toBe(false);
  });

  it('answer other methods with 405', async () => {
    const { kit } = await start();
    expect((await kit.api('/api/location', { method: 'POST', body: {} })).status).toBe(405);
    expect((await kit.api('/api/location/decline', { method: 'GET' })).status).toBe(405);
  });
});

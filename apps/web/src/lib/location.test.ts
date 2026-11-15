import { describe, expect, it } from 'vitest';
import { needsLocation, PositionError, requestPosition, roundCoord } from './location.ts';

describe('needsLocation', () => {
  it.each([
    'look for ramen spots nearby',
    'Ramen near me',
    'any good coffee around here?',
    'what is open now',
    'somewhere open late for dinner',
    'find the closest pharmacy',
    'the nearest gym',
    'best tacos in my area',
    'local restaurants for tonight',
    'what is the weather like',
    "will it rain this weekend, what's the forecast",
    'do I need an umbrella today?',
    'things within walking distance',
  ])('asks for: %s', (text) => expect(needsLocation(text)).toBe(true));

  it.each([
    'what should I make for dinner',
    'write an email to my landlord',
    'weather in Paris tomorrow',
    'forecast for Lisbon this week',
    'is it going to rain in Tokyo',
    'open the local file report.csv',
    'run it on my local machine',
    'compare two laptops',
    'ramen recipes',
    'near the end of the report, add a table',
    '',
  ])('does not ask for: %s', (text) => expect(needsLocation(text)).toBe(false));
});

describe('roundCoord', () => {
  it('keeps two decimals', () => {
    expect(roundCoord(39.952583)).toBe(39.95);
    expect(roundCoord(-75.165222)).toBe(-75.17);
    expect(roundCoord(40)).toBe(40);
  });
});

describe('requestPosition', () => {
  const at = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } });

  it('asks for a low-accuracy position and rounds it', async () => {
    let seen: PositionOptions | undefined;
    const p = await requestPosition(
      {
        getCurrentPosition: (ok, _err, opts) => {
          seen = opts;
          ok(at(39.952583, -75.165222) as GeolocationPosition);
        },
      },
      5000,
    );
    expect(p).toEqual({ lat: 39.95, lon: -75.17 });
    expect(seen).toMatchObject({ enableHighAccuracy: false, timeout: 5000 });
  });

  it('reports a refusal as denied, and other misses as not denied', async () => {
    const fail = (code: number) => ({
      getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback | null) =>
        err?.({ code } as GeolocationPositionError),
    });
    await expect(requestPosition(fail(1))).rejects.toMatchObject({ denied: true });
    await expect(requestPosition(fail(2))).rejects.toMatchObject({ denied: false });
    await expect(requestPosition(fail(3))).rejects.toBeInstanceOf(PositionError);
  });

  it('rejects when the browser has no geolocation', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    await expect(requestPosition(undefined)).rejects.toMatchObject({ denied: false });
  });
});

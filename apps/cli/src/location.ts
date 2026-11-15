// The person's rough location, kept on this machine. The web app asks the browser for it (with the
// person's consent), sends coordinates rounded to two decimals (about a kilometre), and the server
// turns them into a place name once. Only the place name, the rounded coordinates and the time it was
// set are stored, in REMY_HOME/location.json (0600). Turning it off deletes the file's contents.
// Nothing is guessed: with no location set, the situation block says nothing about where the person is.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ScopedFetch } from '@remy/core';
import { z } from 'zod';

/** Two decimals is about a kilometre: enough for "ramen nearby", too coarse to find a house. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;

/** The words used when no place name can be had: near the rounded point. */
export const fallbackPlace = (lat: number, lon: number): string =>
  `near ${roundCoord(lat).toFixed(2)}, ${roundCoord(lon).toFixed(2)}`;

/**
 * Keeps a place name to letters, digits and a little punctuation, at most 120 characters. The name
 * comes from an outside service and ends up in the model's context, so nothing else gets through.
 */
export function cleanPlace(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} ,.'’()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
    .slice(0, 120)
    .trim();
}

/** "Philadelphia, Pennsylvania, US" from a Nominatim reverse answer, or undefined when it names nothing. */
export function placeFromNominatim(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const a = (json as { address?: unknown }).address;
  if (!a || typeof a !== 'object') return undefined;
  const get = (k: string): string | undefined => {
    const v = (a as Record<string, unknown>)[k];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };
  const city =
    get('city') ??
    get('town') ??
    get('village') ??
    get('municipality') ??
    get('hamlet') ??
    get('suburb') ??
    get('county');
  const region = get('state') ?? get('region') ?? get('state_district');
  const cc = get('country_code')?.toUpperCase() ?? get('country');
  const parts = [city, region, cc].filter((p): p is string => Boolean(p));
  if (!city && !region) return undefined; // a country alone is no help for "nearby"
  const place = cleanPlace(parts.join(', '));
  return place || undefined;
}

export const GEOCODER_HOST = 'nominatim.openstreetmap.org';
const REVERSE_URL = `https://${GEOCODER_HOST}/reverse`;

/**
 * Turns rounded coordinates into a place name with OpenStreetMap's Nominatim, once per distinct
 * point (kept in memory), at most one request a second as its usage policy asks. The request carries
 * only the rounded coordinates; the fetch is the scoped one, so its User-Agent is Remy's generic one.
 * Returns the fallback words when the service cannot be reached or names nothing.
 */
export function createGeocoder(
  net: ScopedFetch,
  now: () => number = Date.now,
): {
  reverse(lat: number, lon: number): Promise<{ place: string; named: boolean }>;
} {
  const cache = new Map<string, string>();
  let last = Number.NEGATIVE_INFINITY;
  return {
    async reverse(rawLat, rawLon) {
      const lat = roundCoord(rawLat);
      const lon = roundCoord(rawLon);
      const key = `${lat},${lon}`;
      const hit = cache.get(key);
      if (hit) return { place: hit, named: true };
      const wait = last + 1000 - now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = now();
      try {
        const url = `${REVERSE_URL}?format=jsonv2&zoom=10&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
        const res = await net.get(url);
        if (res.status === 200) {
          const place = placeFromNominatim(JSON.parse(res.body));
          if (place) {
            if (cache.size >= 50) cache.delete(cache.keys().next().value as string);
            cache.set(key, place);
            return { place, named: true };
          }
        }
      } catch {
        // an unreachable or odd answer falls through to the fallback
      }
      return { place: fallbackPlace(lat, lon), named: false };
    },
  };
}

// ---- what is stored

const stored = z
  .object({
    place: z.string().min(1).max(120),
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    setAt: z.string().datetime(),
  })
  .strict();
const fileShape = z
  .object({ location: stored.optional(), declined: z.boolean().optional() })
  .strict();

export interface StoredLocation {
  place: string;
  lat: number;
  lon: number;
  /** ISO time the place was set. */
  setAt: string;
}

/** What the web app and Settings see: never the coordinates. */
export interface LocationView {
  place: string | null;
  setAt: string | null;
  /** The person said no (or turned it off); the web app does not ask again until Settings turns it on. */
  declined: boolean;
}

export interface LocationStore {
  get(): StoredLocation | undefined;
  declined(): boolean;
  set(l: StoredLocation): void;
  /** Deletes the place and remembers not to ask again. */
  turnOff(): void;
  /** The person said no to the browser's question. */
  decline(): void;
  view(): LocationView;
}

export function openLocation(home: string): LocationStore {
  const file = join(home, 'location.json');
  const read = (): z.infer<typeof fileShape> => {
    try {
      const parsed = fileShape.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };
  const write = (v: z.infer<typeof fileShape>) => {
    if (!v.location && !v.declined) {
      if (existsSync(file)) rmSync(file, { force: true });
      return;
    }
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };
  return {
    get: () => read().location,
    declined: () => read().declined === true,
    set: (l) => write({ location: l }),
    turnOff: () => write({ declined: true }),
    decline: () => write({ declined: true }),
    view() {
      const v = read();
      return {
        place: v.location?.place ?? null,
        setAt: v.location?.setAt ?? null,
        declined: v.declined === true && !v.location,
      };
    },
  };
}

/** "set 2 days ago", in the plainest words that are still true. */
export function setAgo(setAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - setAt.getTime());
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'set just now';
  if (hours < 24) return `set ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `set ${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  return `set ${months} months ago`;
}

/** For the situation block: the place when one is set, else nothing (an unreadable file is nothing). */
export function locationFor(home: string): { location?: { place: string; setAt: string } } {
  try {
    const l = openLocation(home).get();
    return l ? { location: { place: l.place, setAt: l.setAt } } : {};
  } catch {
    return {};
  }
}

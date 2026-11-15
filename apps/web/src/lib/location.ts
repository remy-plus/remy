// The browser's rough location, for things that depend on where the person is ("ramen nearby").
// Remy asks the browser only when a message needs it, or when the person turns it on in Settings,
// shows one plain line first, sends coordinates rounded to about a kilometre, and never asks again
// after a refusal. The server turns the point into a place name and keeps it.

/** The one line shown before the browser's own question. */
export const LOCATION_NOTICE =
  'Remy uses your rough location for things nearby. It is kept on your server.';

/** Two decimals is about a kilometre. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;

const NEAR =
  /\b(nearby|near\s+(me|us|here)|around\s+(here|me|us)|close\s+(to\s+(me|us|here)|by)|nearest|closest|in\s+(my|our)\s+(area|town|city|neighbou?rhood)|open\s+(now|late|today|tonight)|walking\s+distance|local\s+(restaurants?|caf[eé]s?|coffee|shops?|stores?|news|events?|bars?|pubs?|gyms?|markets?|parks?|spots?|businesses|doctors?|dentists?|vets?|pharmac(?:y|ies)|services?|things\s+to\s+do))\b/i;

const WEATHER = /\b(weather|forecast|temperature|umbrella|will\s+it\s+(rain|snow))\b/i;
// A place named in the message ("weather in Paris", "forecast for Lisbon") means no location is needed.
const NAMED_PLACE = /\b(?:in|at|for|near)\s+(?:the\s+)?[A-Z][\p{L}'’-]+/u;

/**
 * Whether a message depends on where the person is: words like nearby, near me, around here,
 * open now, local restaurants, or weather with no place named. Deliberately simple.
 */
export function needsLocation(text: string): boolean {
  if (NEAR.test(text)) return true;
  return WEATHER.test(text) && !NAMED_PLACE.test(text);
}

export interface Position {
  lat: number;
  lon: number;
}

/** Why a position could not be had: `denied` is a refusal; anything else is only a miss. */
export class PositionError extends Error {
  readonly denied: boolean;
  constructor(denied: boolean, message: string) {
    super(message);
    this.name = 'PositionError';
    this.denied = denied;
  }
}

type Geo = Pick<Geolocation, 'getCurrentPosition'>;

/** One low-accuracy position from the browser, rounded. Rejects with a PositionError. */
export function requestPosition(
  geo: Geo | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
  timeoutMs = 10_000,
): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new PositionError(false, 'This browser cannot share a location.'));
    geo.getCurrentPosition(
      (p) => resolve({ lat: roundCoord(p.coords.latitude), lon: roundCoord(p.coords.longitude) }),
      (e) =>
        reject(
          new PositionError(
            e.code === 1,
            e.code === 1 ? 'The browser did not allow it.' : 'The browser could not find you.',
          ),
        ),
      // Low accuracy and a cached fix up to ten minutes old: a city block is plenty, and it is quicker.
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 600_000 },
    );
  });
}

/** The browser's remembered answer: 'denied', 'granted', or 'prompt' when it will ask (or cannot say). */
export async function permissionState(): Promise<'denied' | 'granted' | 'prompt'> {
  try {
    const s = await navigator.permissions?.query({ name: 'geolocation' });
    return s?.state ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

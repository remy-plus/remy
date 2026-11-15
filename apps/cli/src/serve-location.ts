// `remy serve` location routes. The web app asks the browser for a rough position (with the person's
// consent), sends it here rounded to two decimals, and this turns it into a place name once.
//
//   GET    /api/location          -> { place, setAt, declined }     (never the coordinates)
//   PUT    /api/location          { lat, lon }  -> the same
//   POST   /api/location/decline  -> the same (the person said no; the app stops asking)
//   DELETE /api/location          -> the same (deletes the place; the app stops asking)
//
// Like every route, these come after the Host, cross-site and bearer-token checks in serve.ts.
// The server rounds again, so a client that sends more precision gets no more precision stored.
import { z } from 'zod';
import {
  type createGeocoder,
  type LocationStore,
  type LocationView,
  roundCoord,
  type StoredLocation,
} from './location.ts';
import { guard, HttpFail, jsonBody, type Mount, methodNotAllowed, ok } from './serve-mount.ts';

const position = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  })
  .strict();

export interface LocationMountDeps {
  store: LocationStore;
  geocoder: ReturnType<typeof createGeocoder>;
  now?: () => Date;
}

export function createLocationMount(deps: LocationMountDeps): Mount {
  const now = deps.now ?? (() => new Date());
  let working = false;
  const view = (): LocationView => deps.store.view();
  return guard(async ({ req, method, parts }) => {
    if (parts[0] !== 'location') return undefined;
    if (parts.length === 1) {
      if (method === 'GET') return ok(view());
      if (method === 'DELETE') {
        deps.store.turnOff();
        return ok(view());
      }
      if (method !== 'PUT') return methodNotAllowed('GET, PUT, DELETE');
      const { lat: rawLat, lon: rawLon } = await jsonBody(req, position);
      const lat = roundCoord(rawLat);
      const lon = roundCoord(rawLon);
      if (working) throw new HttpFail(429, 'Remy is still working out where you are.');
      working = true;
      try {
        const before = deps.store.get();
        // The same rounded point as last time already has its name: no second request to the service.
        const place =
          before && before.lat === lat && before.lon === lon
            ? before.place
            : (await deps.geocoder.reverse(lat, lon)).place;
        const next: StoredLocation = { place, lat, lon, setAt: now().toISOString() };
        try {
          deps.store.set(next);
        } catch {
          throw new HttpFail(500, 'Your location could not be saved.');
        }
      } finally {
        working = false;
      }
      return ok(view());
    }
    if (parts.length === 2 && parts[1] === 'decline') {
      if (method !== 'POST') return methodNotAllowed('POST');
      // Saying no never deletes a place the person set on purpose.
      if (!deps.store.get()) deps.store.decline();
      return ok(view());
    }
    return undefined;
  });
}

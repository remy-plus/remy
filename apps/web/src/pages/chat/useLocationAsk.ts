// Asks the browser for a rough location the first time a message needs it, before the message goes,
// so the very same turn knows where the person is. One plain line shows first; a refusal is
// remembered on the server and never asked again (only Settings > Location can turn it back on).
import { useCallback, useRef, useState } from 'react';
import { useApi } from '../../api/index.tsx';
import {
  LOCATION_NOTICE,
  needsLocation,
  PositionError,
  permissionState,
  requestPosition,
} from '../../lib/location.ts';

/** How long a message waits for the person to answer the browser's question before it goes anyway. */
export const LOCATION_WAIT_MS = 20_000;

export function useLocationAsk(): {
  /** The line to show while the browser's question is open; null otherwise. */
  notice: string | null;
  /** Call before sending a message. Resolves when the message may go. Never throws. */
  beforeSend(text: string): Promise<void>;
} {
  const api = useApi();
  const [notice, setNotice] = useState<string | null>(null);
  // Once per page visit: a miss (no signal, a timeout) is not a refusal, but it is not worth asking twice.
  const tried = useRef(false);

  const beforeSend = useCallback(
    async (text: string) => {
      const { location, setLocation, declineLocation } = api;
      if (tried.current || !location || !setLocation || !needsLocation(text)) return;
      if (typeof navigator === 'undefined' || !navigator.geolocation) return;
      try {
        const known = await location.call(api);
        if (known.place || known.declined) {
          tried.current = true; // set already, or the person said no: nothing to ask
          return;
        }
      } catch {
        return; // the server cannot say: send the message as it is
      }
      tried.current = true;
      const work = (async () => {
        try {
          const permission = await permissionState();
          if (permission === 'denied') {
            await declineLocation?.call(api);
            return;
          }
          // The line comes first; when the browser already allowed it there is no question to explain.
          if (permission === 'prompt') setNotice(LOCATION_NOTICE);
          const p = await requestPosition();
          await setLocation.call(api, p.lat, p.lon);
        } catch (e) {
          if (e instanceof PositionError && e.denied)
            await declineLocation?.call(api).catch(() => {});
          // any other miss: the message goes without a location
        }
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<void>((r) => {
        timer = setTimeout(r, LOCATION_WAIT_MS);
      });
      try {
        await Promise.race([work, wait]);
      } finally {
        clearTimeout(timer);
        setNotice(null);
      }
    },
    [api],
  );

  return { notice, beforeSend };
}

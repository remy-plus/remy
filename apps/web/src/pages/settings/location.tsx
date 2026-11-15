// Settings > Location: the rough place Remy uses for things nearby. It is asked of the browser only
// when the person turns it on here or sends a message that needs it. The place name and when it was
// set are kept on the machine that runs Remy; turning it off deletes them.
import { useCallback, useEffect, useState } from 'react';
import { type LocationState, useApi } from '../../api/index.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import {
  LOCATION_NOTICE,
  PositionError,
  permissionState,
  requestPosition,
} from '../../lib/location.ts';
import { ago } from '../../lib/when.ts';
import { Row, RowError } from './controls.tsx';
import type { SectionProps } from './sections.ts';

export const LOCATION_HELP = `${LOCATION_NOTICE} Turn it off and it is deleted.`;
export const LOCATION_DENIED =
  'Your browser did not allow it. Allow location for this page in the browser, then try again.';
export const LOCATION_MISSED = 'Your browser could not find you just now. Try again in a moment.';

export function LocationSection(_props: SectionProps) {
  const api = useApi();
  const supported = Boolean(api.location);
  const [state, setState] = useState<LocationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    if (!api.location) return;
    let live = true;
    api.location().then(
      (s) => {
        if (!live) return;
        setState(s);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setError(
          describeError(
            e,
            'Remy could not read your location setting. Check that it is running, then try again.',
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [api, n]);

  const turnOn = async () => {
    if (!api.setLocation) return;
    setBusy(true);
    setNote('');
    try {
      if ((await permissionState()) === 'denied') {
        setNote(LOCATION_DENIED);
        return;
      }
      const p = await requestPosition();
      setState(await api.setLocation(p.lat, p.lon));
      setNote('Your location is saved.');
    } catch (e) {
      setNote(
        e instanceof PositionError
          ? e.denied
            ? LOCATION_DENIED
            : LOCATION_MISSED
          : describeError(
              e,
              'Your location did not save. Check that Remy is running, then try again.',
            ),
      );
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!api.clearLocation) return;
    setBusy(true);
    setNote('');
    try {
      setState(await api.clearLocation());
      setNote('Location is off and what was saved is deleted.');
    } catch (e) {
      setNote(
        describeError(
          e,
          'Location could not be turned off. Check that Remy is running, then try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row title="Your rough location" help={LOCATION_HELP}>
      {!supported ? (
        <p className="m-0 max-w-[520px] text-[14px] leading-relaxed text-muted">
          This server does not offer a location setting yet.
        </p>
      ) : state ? (
        <>
          {state.place ? (
            <>
              <p className="mt-0 mb-1 text-[15px]">{state.place}</p>
              <p className="mt-0 mb-4 text-[13px] text-muted">
                Approximate, set {state.setAt ? ago(state.setAt) : 'earlier'}. Remy mentions it only
                to answer things like "ramen nearby".
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={buttonQuiet} disabled={busy} onClick={turnOn}>
                  Update
                </button>
                <button type="button" className={buttonQuiet} disabled={busy} onClick={turnOff}>
                  Turn off
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-0 mb-4 max-w-[520px] text-[15px] leading-relaxed">
                {state.declined
                  ? 'Location is off. Remy will not ask for it in the chat.'
                  : 'Remy does not know where you are. It will ask in the chat the first time you ask for something nearby.'}
              </p>
              <button type="button" className={buttonPrimary} disabled={busy} onClick={turnOn}>
                Turn on location
              </button>
            </>
          )}
          <p role="status" className="mt-3 mb-0 flex items-center gap-2 text-[13px] text-muted">
            {note && !/did not|could not|Allow location/.test(note) && (
              <Icon name="check" className="shrink-0 text-signal" />
            )}
            {busy && !note ? 'Working it out' : note}
          </p>
        </>
      ) : error ? (
        <RowError message={error} onRetry={reload} />
      ) : (
        <Skeleton label="Loading your location setting" lines={2} />
      )}
    </Row>
  );
}

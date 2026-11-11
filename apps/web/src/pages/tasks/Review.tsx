import { useCallback, useEffect, useState } from 'react';
import { type ReviewData, useApi } from '../../api/index.tsx';
import { ApprovalDialog } from '../../components/ApprovalDialog.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { describeError } from '../../lib/errors.ts';
import { plainTime, primaryButton, quietButton, trustWords } from './format.ts';

const mono = 'font-mono';

/** What the answer means, in the words of the kind of thing being approved. */
const approvedSaid = (kind: string) =>
  /spend|pay/i.test(kind)
    ? 'Approved. Remy is paying it.'
    : /send/i.test(kind)
      ? 'Approved. Remy is sending it.'
      : 'Approved. Remy is carrying on.';

const declinedSaid = (kind: string) =>
  /spend|pay/i.test(kind)
    ? 'Not now. Nothing was paid.'
    : /send/i.test(kind)
      ? 'Not now. Nothing was sent.'
      : 'Not now. Nothing was changed.';

export function Review() {
  const api = useApi();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    let live = true;
    api
      .review()
      .then((r) => {
        if (!live) return;
        setData(r);
        setError(null);
      })
      .catch(
        (e: unknown) =>
          live && setError(describeError(e, 'Remy could not load the overnight review.')),
      );
    return () => {
      live = false;
    };
  }, [api, n]);

  if (error)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <h1 className="m-0 text-[28px] font-medium">Overnight review</h1>
        <p className="mt-3 max-w-[560px] text-muted">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={reload}>
            Try again
          </button>
          <a href="#/activity" className={quietButton}>
            See what Remy has done
          </a>
        </div>
      </div>
    );
  if (!data)
    return (
      <Skeleton label="Loading what needs your look" lines={4} className="px-5 py-12 sm:px-8" />
    );

  const needs = skipped ? null : data.needs;
  // The server sends times like "23:10 to 07:40"; both ends are said in 12-hour words.
  const span = data.span
    .split(/\s+to\s+/)
    .map((t) => plainTime(t))
    .join(' to ');
  return (
    <div className="grid min-h-[calc(100dvh-66px)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 px-5 pt-8 pb-12 sm:px-8 lg:pr-12 lg:pl-14">
        <p className={`${mono} m-0 mb-3 text-[12px] text-muted`}>While you were away · {span}</p>
        <h1 className="m-0 mb-6 max-w-[800px] text-[30px] leading-[1.15] font-medium tracking-tight sm:text-[40px]">
          {data.headline} <span className="text-muted">{data.rest}</span>
        </h1>

        <ul className="m-0 mb-8 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {data.tiles.map((t) => (
            <li key={t.label} className="rounded-[10px] border border-edge bg-surface px-4 py-4">
              <p className={`${mono} m-0 text-[26px] font-medium`}>{t.value}</p>
              <p className={`${mono} mt-1 mb-0 text-[12px] text-muted`}>{t.label}</p>
            </li>
          ))}
        </ul>

        <section aria-label="What happened">
          <div className={`${mono} mb-4 flex justify-between text-[12px] text-muted`}>
            <h2 className="m-0 text-[12px] font-normal">What happened</h2>
            <span>in order</span>
          </div>
          <ol className="m-0 list-none p-0">
            {data.timeline.map((e, i) => (
              <li
                key={e.at + e.title}
                // Wide enough for a 12-hour time ("11:10 PM") on one line.
                className="grid grid-cols-[64px_28px_minmax(0,1fr)] gap-x-1 sm:grid-cols-[76px_28px_minmax(0,1fr)]"
              >
                <time className={`${mono} pt-0.5 text-right text-[12px] text-muted`}>
                  {plainTime(e.at)}
                </time>
                <span className="relative flex justify-center">
                  <span
                    aria-hidden="true"
                    className={`z-[1] mt-1.5 size-3 rounded-full border ${e.waiting ? 'border-text bg-text' : 'border-signal bg-bg'}`}
                  />
                  {i < data.timeline.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-[18px] -bottom-[6px] left-1/2 w-px bg-stone"
                    />
                  )}
                </span>
                <div className="min-w-0 pb-5">
                  <p className="m-0 text-[17px] leading-snug font-medium">
                    {e.title}
                    {e.tag && (
                      <span
                        className={`${mono} ml-2 rounded border border-edge px-1.5 py-px text-[11px] font-normal text-muted`}
                      >
                        {e.tag}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 mb-0 text-[14px] leading-snug text-muted">{e.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside
        aria-label="Needs you"
        className="border-t border-edge px-5 py-8 lg:border-t-0 lg:border-l lg:px-7"
      >
        <div className={`${mono} mb-3 flex justify-between text-[12px] text-muted`}>
          <h2 className="m-0 text-[12px] font-normal">Needs you</h2>
          <span>{needs ? 1 : 0}</span>
        </div>
        {said && (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 text-[14px] leading-snug text-text"
          >
            <Icon name="check" className="mt-0.5 shrink-0 text-signal" />
            {said}
          </p>
        )}
        {needs ? (
          <div className="mb-4 rounded-[10px] border border-edge-hi bg-surface p-4">
            <p className={`${mono} m-0 text-[12px] text-muted`}>{needs.kind}</p>
            <h3 className="mt-1 mb-2 text-[17px] font-semibold">{needs.title}</h3>
            {/* The draft itself, in full: it is the thing being decided. */}
            <p className="m-0 mb-3 text-[14px] leading-snug text-muted">{needs.quote}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => setReviewing(true)}>
                Review and send
              </button>
              <button
                type="button"
                className={quietButton}
                onClick={() => {
                  setSkipped(true);
                  setSaid(declinedSaid(needs.kind));
                }}
              >
                Not now
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-[10px] border border-edge bg-surface p-4">
            <p className="m-0 text-[15px] leading-snug">Nothing is waiting for you.</p>
            <p className="mt-1 mb-3 text-[14px] leading-snug text-muted">
              Remy did everything it was allowed to do on its own. Anything it did is in Activity.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="#/activity" className={quietButton}>
                See what Remy did
              </a>
              <a href="#/" className={quietButton}>
                Ask Remy for something
              </a>
            </div>
          </div>
        )}
        {data.awayNote && (
          <p className="m-0 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-[1.6] text-muted">
            How much Remy does on its own:{' '}
            <strong className="font-medium text-text">{trustWords[data.awayNote.trust]}</strong>.{' '}
            {data.awayNote.text}
          </p>
        )}
      </aside>

      {reviewing && data.needs && (
        <ApprovalDialog
          taskId={data.needs.taskId}
          onClose={() => setReviewing(false)}
          onResolved={(granted) => {
            setSaid(
              granted ? approvedSaid(data.needs?.kind ?? '') : declinedSaid(data.needs?.kind ?? ''),
            );
            setSkipped(true);
          }}
        />
      )}
    </div>
  );
}

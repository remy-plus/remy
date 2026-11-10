import { useEffect, useState } from 'react';
import { type ReviewData, useApi } from '../../api/index.tsx';
import { ApprovalDialog } from '../../components/ApprovalDialog.tsx';
import { primaryButton, quietButton } from './format.ts';

const mono = 'font-mono';

export function Review() {
  const api = useApi();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .review()
      .then((r) => live && setData(r))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load.'));
    return () => {
      live = false;
    };
  }, [api]);

  if (error)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <h1 className="m-0 text-[28px] font-medium">Overnight review</h1>
        <p className="mt-3 text-muted">{error}</p>
        <a href="#/tasks" className={`${quietButton} mt-4 inline-block`}>
          Back to tasks
        </a>
      </div>
    );
  if (!data)
    return (
      <p role="status" className={`${mono} px-5 py-12 text-[13px] text-muted sm:px-8`}>
        Loading
      </p>
    );

  const needs = skipped ? null : data.needs;
  return (
    <div className="grid min-h-[calc(100dvh-66px)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 px-5 pt-8 pb-12 sm:px-14">
        <p className={`${mono} m-0 mb-3 text-[12px] text-muted`}>
          While you were away · {data.span}
        </p>
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
                className="grid grid-cols-[48px_28px_minmax(0,1fr)] gap-x-1 sm:grid-cols-[60px_28px_minmax(0,1fr)]"
              >
                <time className={`${mono} pt-0.5 text-right text-[12px] text-muted`}>{e.at}</time>
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
        {needs ? (
          <div className="mb-4 rounded-[10px] border border-edge-hi bg-surface p-4">
            <p className={`${mono} m-0 text-[12px] text-muted`}>{needs.kind}</p>
            <h3 className="mt-1 mb-2 text-[17px] font-semibold">{needs.title}</h3>
            <p className="m-0 mb-3 text-[14px] leading-snug text-muted">{needs.quote}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={() => setReviewing(true)}>
                Review and send
              </button>
              <button type="button" className={quietButton} onClick={() => setSkipped(true)}>
                Skip
              </button>
            </div>
          </div>
        ) : (
          <p className="mb-4 text-[14px] text-muted">Nothing is waiting for you.</p>
        )}
        {data.awayNote && (
          <p className="m-0 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-[1.6] text-muted">
            Trust was set to{' '}
            <strong className="font-medium text-text">{data.awayNote.trust}</strong> for the night.{' '}
            {data.awayNote.text}
          </p>
        )}
      </aside>

      {reviewing && data.needs && (
        <ApprovalDialog
          taskId={data.needs.taskId}
          onClose={() => setReviewing(false)}
          onResolved={() => setSkipped(true)}
        />
      )}
    </div>
  );
}

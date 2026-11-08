import { useState } from 'react';
import type { ScheduleItem, Webhook } from '../../api/index.tsx';
import {
  Eyebrow,
  Loading,
  mono,
  Notice,
  Page,
  primary,
  quiet,
  Switch,
  Unavailable,
  useLoad,
} from './ui.tsx';

export function Schedules() {
  const { api, data, setData, error } = useLoad((a) => a.schedules());
  const [said, setSaid] = useState<{ text: string; taskId?: string } | null>(null);
  if (error) return <Unavailable message={error} />;
  if (!data) return <Loading />;

  const refresh = async () => setData(await api.schedules());
  const fail = (e: unknown) =>
    setSaid({ text: e instanceof Error ? e.message : 'That did not work.' });
  const toggle = (s: ScheduleItem, on: boolean) =>
    api.setScheduleEnabled(s.id, on).then(refresh, fail);
  const runNow = (s: ScheduleItem) =>
    api
      .runScheduleNow(s.id)
      .then((r) => setSaid({ text: `Started ${s.title}.`, taskId: r.taskId }), fail);
  const toggleHook = (w: Webhook, on: boolean) =>
    api.setWebhookEnabled(w.id, on).then(refresh, fail);

  return (
    <Page
      title="Schedules"
      lead="Things Remy does on its own, on time. Anything that sends or spends still waits for you."
      asideWidth="lg:grid-cols-[minmax(0,1fr)_420px]"
      aside={
        <div>
          <section aria-labelledby="next-h">
            <Eyebrow id="next-h">Next 24 hours</Eyebrow>
            <ol className="m-0 mt-4 mb-8 list-none p-0">
              {data.timeline.map((t) => (
                <li
                  key={`${t.at}-${t.title}`}
                  className="relative pb-5 pl-7 before:absolute before:top-3 before:bottom-0 before:left-[5px] before:w-px before:bg-stone last:before:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-1 left-0 size-[11px] rounded-full border border-stone ${t.soon ? 'border-signal bg-signal' : 'bg-bg'}`}
                  />
                  <p className={`${mono} m-0 text-[12px] text-muted`}>{t.at}</p>
                  <p className="m-0 text-[16px]">
                    {t.title}
                    {t.note && <span className="text-muted"> ({t.note})</span>}
                  </p>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="away-h">
            <Eyebrow id="away-h">While you were away</Eyebrow>
            <p className="mt-3 mb-0 rounded-[10px] border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-muted">
              {data.away}{' '}
              <a href="#/review" className="text-text underline">
                Open the overnight review
              </a>
              .
            </p>
          </section>
        </div>
      }
    >
      <section aria-labelledby="recurring-h" className="mb-5">
        <div className="mb-3 flex items-baseline justify-between">
          <Eyebrow id="recurring-h">Recurring</Eyebrow>
          <span className={`${mono} text-[12px] text-muted`}>{data.schedules.length}</span>
        </div>
        <ul className="m-0 list-none border-t border-line p-0">
          {data.schedules.map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-4 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_40px_84px]"
            >
              <div className="col-span-2 min-w-0 min-[900px]:col-span-1">
                <h3 className="m-0 text-[16px] font-medium">{s.title}</h3>
                <p className="m-0 mt-1 text-[14px] text-muted">{s.detail}</p>
              </div>
              <p className={`${mono} m-0 min-w-0 text-[13px]`}>{s.when}</p>
              <p className={`${mono} m-0 min-w-0 text-[12px] text-muted`}>{s.next}</p>
              <Switch checked={s.enabled} label={s.title} onChange={(on) => toggle(s, on)} />
              {s.fix ? (
                <a href={s.fix.href} className={`${primary} block text-center`}>
                  {s.fix.label}
                </a>
              ) : (
                <button
                  type="button"
                  className={`${quiet} w-full`}
                  aria-label={`Run now: ${s.title}`}
                  onClick={() => runNow(s)}
                >
                  Run now
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <a href="#/schedules/new" className={primary}>
          New schedule
        </a>
        <Notice>
          {said?.text}{' '}
          {said?.taskId && (
            <a className="text-text underline" href={`#/tasks/${said.taskId}`}>
              Open the task
            </a>
          )}
        </Notice>
      </div>

      <section aria-labelledby="hooks-h" className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
          <Eyebrow id="hooks-h">Webhooks</Eyebrow>
          <span className={`${mono} text-[12px] text-muted`}>{data.webhooksNote}</span>
        </div>
        <ul className="m-0 list-none p-0">
          {data.webhooks.map((w) => (
            <li key={w.id} className="rounded-[10px] border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="m-0 text-[16px] font-medium">{w.name}</h3>
                <Switch
                  checked={w.enabled}
                  label={`${w.name} webhook`}
                  onChange={(on) => toggleHook(w, on)}
                />
              </div>
              <p className={`${mono} mt-2 mb-2 text-[13px] break-all`}>{w.url}</p>
              <p className="m-0 text-[14px] leading-relaxed text-muted">{w.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

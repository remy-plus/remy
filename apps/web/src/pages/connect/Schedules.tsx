import { useState } from 'react';
import type { ScheduleItem, Webhook } from '../../api/index.tsx';
import { BrainTabs } from '../../components/BrainTabs.tsx';
import { describeError } from '../../lib/errors.ts';
import { clock } from '../../lib/when.ts';
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

const FALLBACK = 'That did not work. Check that Remy is still running, then try again.';
const empty = 'rounded-[10px] border border-edge bg-surface px-4 py-5';
const code = `${mono} text-[13px]`;

/** A change, said beside the row it changed; a started job keeps its own line at the bottom. */
type Said = { text: string; taskId?: string; id?: string };

/** Server text like "Fridays at 16:00" said the way a person reads a clock: "Fridays at 4:00 PM". */
export function plainTime(text: string): string {
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_all, h: string, min: string) => {
    const d = new Date();
    d.setHours(Number(h), Number(min), 0, 0);
    return clock(d);
  });
}

export function Schedules() {
  const { api, data, setData, error, reload } = useLoad((a) => a.schedules());
  const [said, setSaid] = useState<Said | null>(null);
  if (error) return <Unavailable message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading your schedules" />;

  const refresh = async () => setData(await api.schedules());
  const toggle = async (s: ScheduleItem, on: boolean) => {
    try {
      await api.setScheduleEnabled(s.id, on);
      await refresh();
      setSaid({
        id: s.id,
        text: on
          ? `${s.title} is on. Remy runs it on time.`
          : `${s.title} is off. Remy will not run it.`,
      });
    } catch (e) {
      setSaid({ id: s.id, text: describeError(e, FALLBACK) });
    }
  };
  const runNow = async (s: ScheduleItem) => {
    try {
      const r = await api.runScheduleNow(s.id);
      setSaid({ text: `Started ${s.title}.`, taskId: r.taskId });
    } catch (e) {
      setSaid({ text: describeError(e, FALLBACK) });
    }
  };
  const toggleHook = async (w: Webhook, on: boolean) => {
    try {
      await api.setWebhookEnabled(w.id, on);
      await refresh();
      setSaid({
        id: w.id,
        text: on
          ? `Webhooks are on. ${w.name} can start a job.`
          : `Webhooks are off. ${w.name} cannot start a job.`,
      });
    } catch (e) {
      setSaid({ id: w.id, text: describeError(e, FALLBACK) });
    }
  };

  return (
    <Page
      title="Schedules"
      tabs={<BrainTabs current="schedules" />}
      lead="Things Remy does on its own, on time. Anything that sends or spends still waits for you."
      asideWidth="lg:grid-cols-[minmax(0,1fr)_420px]"
      aside={
        <div>
          <section aria-labelledby="next-h">
            <Eyebrow id="next-h">Next 24 hours</Eyebrow>
            {data.timeline.length === 0 ? (
              <p className="mt-4 mb-8 text-[14px] text-muted">
                Nothing is due in the next 24 hours.
              </p>
            ) : (
              <ol className="m-0 mt-4 mb-8 list-none p-0">
                {data.timeline.map((t) => (
                  <li
                    key={`${t.at}-${t.title}`}
                    className="relative pb-5 pl-7 before:absolute before:top-3 before:bottom-0 before:left-[5px] before:w-px before:bg-stone last:before:hidden"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-1 left-0 size-[11px] rounded-full border border-edge-hi ${t.soon ? 'border-signal bg-signal' : 'bg-bg'}`}
                    />
                    <p className={`${mono} m-0 text-[12px] text-muted`}>{plainTime(t.at)}</p>
                    <p className="m-0 text-[16px]">
                      {t.title}
                      {t.note && <span className="text-muted"> ({t.note})</span>}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section aria-labelledby="away-h">
            <Eyebrow id="away-h">While you were away</Eyebrow>
            <p className="mt-3 mb-0 rounded-[10px] border border-edge bg-surface px-4 py-3 text-[14px] leading-relaxed text-muted">
              {data.away}{' '}
              <a href="#/review" className="text-text underline">
                Take a look at last night
              </a>
              .
            </p>
          </section>
        </div>
      }
    >
      <section aria-labelledby="recurring-h" className="mb-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Eyebrow id="recurring-h">Recurring</Eyebrow>
          {data.schedules.length > 0 && (
            <span className={`${mono} text-[12px] text-muted`}>{data.schedules.length}</span>
          )}
        </div>
        <p className="mt-0 mb-3 max-w-[560px] text-[14px] leading-relaxed text-muted">
          Times are the clock of the machine Remy runs on.
        </p>
        {data.schedules.length === 0 ? (
          <div className={empty}>
            <p className="m-0 text-[15px]">No schedule yet.</p>
            <p className="mt-1 mb-4 max-w-[520px] text-[14px] leading-relaxed text-muted">
              A schedule is something Remy does on its own, on time, like a summary every Friday.
            </p>
            <a className={primary} href="#/schedules/new">
              Create a schedule
            </a>
          </div>
        ) : (
          <ul className="m-0 list-none border-t border-edge p-0">
            {data.schedules.map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-edge py-4 min-[900px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_40px_84px]"
              >
                <div className="col-span-2 min-w-0 min-[900px]:col-span-1">
                  <h3 className="m-0 text-[16px] font-medium">{s.title}</h3>
                  <p className="m-0 mt-1 text-[14px] text-muted">{s.detail}</p>
                  {said?.id === s.id && (
                    <p role="status" className="m-0 mt-1 text-[13px] text-text">
                      {said.text}
                    </p>
                  )}
                </div>
                <p className={`${mono} m-0 min-w-0 text-[13px]`}>{plainTime(s.when)}</p>
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
        )}
      </section>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {data.schedules.length > 0 && (
          <a href="#/schedules/new" className={primary}>
            Create a schedule
          </a>
        )}
        {said && !said.id && (
          <Notice>
            {said.text}{' '}
            {said.taskId && (
              <a className="text-text underline" href={`#/tasks/${said.taskId}`}>
                Open the job
              </a>
            )}
          </Notice>
        )}
      </div>

      <section aria-labelledby="hooks-h" className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
          <Eyebrow id="hooks-h">Webhooks</Eyebrow>
          <span className={`${mono} text-[12px] text-muted`}>{data.webhooksNote}</span>
        </div>
        {data.webhooks.length === 0 ? (
          <div className={empty}>
            <p className="m-0 text-[15px]">No webhook yet.</p>
            <p className="mt-1 mb-0 max-w-[560px] text-[14px] leading-relaxed text-muted">
              A webhook lets an outside service start a job. Adding one is not available in the app
              yet: do it in the terminal with{' '}
              <code className={code}>
                remy webhook add &lt;name&gt; &quot;&lt;what to do&gt;&quot;
              </code>
              , then reload this page.
            </p>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {data.webhooks.map((w) => (
              <li key={w.id} className="rounded-[10px] border border-edge bg-surface p-4">
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
                {said?.id === w.id && (
                  <p role="status" className="m-0 mt-2 text-[13px] text-text">
                    {said.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

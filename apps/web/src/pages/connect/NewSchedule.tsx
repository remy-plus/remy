import { type FormEvent, useId, useState } from 'react';
import { field, Loading, mono, Notice, primary, quiet, Unavailable, useLoad } from './ui.tsx';

const HOW_OFTEN = ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Custom'] as const;
type Often = (typeof HOW_OFTEN)[number];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const ordinal = (n: number) => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? 'th'}`;
};

/** The phrase the scheduler reads, like "every Monday at 08:30". */
export function whenPhrase(o: {
  often: Often;
  day: string;
  monthDay: number;
  time: string;
  custom: string;
}): string {
  switch (o.often) {
    case 'Hourly':
      return 'every hour';
    case 'Daily':
      return `every day at ${o.time}`;
    case 'Weekly':
      return `every ${o.day} at ${o.time}`;
    case 'Monthly':
      return `on the ${ordinal(o.monthDay)} of every month at ${o.time}`;
    default:
      return o.custom.trim();
  }
}

export function NewSchedule() {
  const { api, data, error } = useLoad((a) => a.schedules());
  const uid = useId();
  const [prompt, setPrompt] = useState('');
  const [often, setOften] = useState<Often>('Weekly');
  const [day, setDay] = useState('Monday');
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState('08:30');
  const [custom, setCustom] = useState('');
  const [zone, setZone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
    } catch {
      return 'Europe/London';
    }
  });
  const [runsOn, setRunsOn] = useState('this machine');
  const [errors, setErrors] = useState<Partial<Record<'prompt' | 'time' | 'custom', string>>>({});
  const [problem, setProblem] = useState('');
  if (error) return <Unavailable message={error} />;
  if (!data) return <Loading />;

  const check = () => {
    const e: typeof errors = {};
    if (!prompt.trim()) e.prompt = 'Say what Remy should do.';
    if (often !== 'Hourly' && often !== 'Custom' && !TIME.test(time))
      e.time = 'Use a time like 08:30.';
    if (often === 'Custom' && !custom.trim()) e.custom = 'Say when, for example “every 2 hours”.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setProblem('');
    if (!check()) return;
    try {
      await api.createSchedule({
        prompt: prompt.trim(),
        when: whenPhrase({ often, day, monthDay, time, custom }),
        timezone: zone,
        runsOn,
      });
      window.location.hash = '#/schedules';
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : 'That did not work. Check that Remy is still running, then try again.',
      );
    }
  };
  const once = async () => {
    setProblem('');
    if (!prompt.trim()) {
      setErrors({ prompt: 'Say what Remy should do.' });
      return;
    }
    try {
      const { taskId } = await api.startTask(prompt.trim());
      window.location.hash = `#/tasks/${taskId}`;
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : 'That did not work. Check that Remy is still running, then try again.',
      );
    }
  };
  const bad = (k: keyof typeof errors) => ({
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] ? `${uid}-${k}-msg` : undefined,
  });
  const msg = (k: keyof typeof errors) =>
    errors[k] && (
      <p id={`${uid}-${k}-msg`} className="mt-2 mb-0 text-[13px] text-[#d98b7a]">
        {errors[k]}
      </p>
    );
  const label = `${mono} mb-2 block text-[12px] text-muted`;
  const small = `${mono} rounded-[10px] border border-edge bg-bg px-3.5 py-2 text-[14px] text-text aria-[invalid=true]:border-[#d98b7a]`;

  return (
    <div className="px-5 py-10 sm:px-8">
      <form
        onSubmit={submit}
        noValidate
        aria-labelledby={`${uid}-title`}
        className="mx-auto max-w-[680px] rounded-[14px] border border-edge bg-surface p-5 sm:p-8"
      >
        <h1 id={`${uid}-title`} className="m-0 text-[26px] font-normal leading-tight">
          New schedule
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-muted">
          Remy does this on its own, on time. Anything that sends or spends still waits for you.
        </p>

        <label htmlFor={`${uid}-prompt`} className={label}>
          What should Remy do?
        </label>
        <textarea
          id={`${uid}-prompt`}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Every Monday, read last week’s emails from Dana and write me a three-line summary of what is open."
          className={`${field} bg-bg`}
          {...bad('prompt')}
        />
        {msg('prompt')}

        <div role="radiogroup" aria-labelledby={`${uid}-often`} className="mt-6">
          <p id={`${uid}-often`} className={`${label} mb-2`}>
            How often
          </p>
          <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-edge-hi">
            {HOW_OFTEN.map((o) => (
              <label
                key={o}
                className={`${mono} cursor-pointer border-r border-edge-hi px-4 py-2 text-[13px] last:border-r-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text ${often === o ? 'bg-signal font-medium text-signal-ink' : 'text-muted hover:text-text'}`}
              >
                <input
                  type="radio"
                  name={`${uid}-often`}
                  value={o}
                  checked={often === o}
                  onChange={() => setOften(o)}
                  className="sr-only"
                />
                {o}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className={label}>When</p>
          {often === 'Hourly' ? (
            <p className="m-0 text-[14px] text-muted">At the start of every hour.</p>
          ) : often === 'Custom' ? (
            <>
              <label htmlFor={`${uid}-custom`} className="sr-only">
                When, in words
              </label>
              <input
                id={`${uid}-custom`}
                className={`${field} ${mono} text-[14px]`}
                placeholder="every 2 hours, or weekdays at 8:30"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                {...bad('custom')}
              />
              {msg('custom')}
            </>
          ) : (
            <div className="flex flex-wrap gap-3">
              {often === 'Weekly' && (
                <>
                  <label htmlFor={`${uid}-day`} className="sr-only">
                    Day of the week
                  </label>
                  <select
                    id={`${uid}-day`}
                    className={small}
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  >
                    {DAYS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </>
              )}
              {often === 'Monthly' && (
                <>
                  <label htmlFor={`${uid}-md`} className="sr-only">
                    Day of the month
                  </label>
                  <select
                    id={`${uid}-md`}
                    className={small}
                    value={monthDay}
                    onChange={(e) => setMonthDay(Number(e.target.value))}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {ordinal(d)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label htmlFor={`${uid}-time`} className="sr-only">
                Time
              </label>
              <input
                id={`${uid}-time`}
                className={`${small} w-[110px]`}
                value={time}
                inputMode="numeric"
                onChange={(e) => setTime(e.target.value)}
                {...bad('time')}
              />
              <label htmlFor={`${uid}-zone`} className="sr-only">
                Time zone
              </label>
              <input
                id={`${uid}-zone`}
                className={`${small} min-w-0`}
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
            </div>
          )}
          {often !== 'Custom' && msg('time')}
        </div>

        <div className="mt-6">
          <label htmlFor={`${uid}-runs`} className={label}>
            Where it runs
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              id={`${uid}-runs`}
              className={small}
              value={runsOn}
              onChange={(e) => setRunsOn(e.target.value)}
            >
              {data.runsOn.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <span className="text-[14px] text-muted">
              or pick a machine to keep it going while your laptop sleeps
            </span>
          </div>
        </div>

        <p className="mt-6 mb-6 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-relaxed text-muted">
          While it runs, Remy works at trust level{' '}
          <strong className="font-semibold text-text">{data.policy.trust}</strong> and stops to ask
          if a run costs more than {data.policy.stopAbove}.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primary}>
            Save schedule
          </button>
          <button type="button" className={quiet} onClick={once}>
            Run it once now
          </button>
          <a href="#/schedules" className={quiet}>
            Cancel
          </a>
        </div>
        <div className="mt-3">
          <Notice>{problem}</Notice>
        </div>
      </form>
    </div>
  );
}

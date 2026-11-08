import { type FormEvent, type ReactNode, type RefObject, useId, useRef, useState } from 'react';
import { type HomeData, type NeedCard, type Notice, useApi, type WorkItem } from '../api/index.tsx';
import { Orb } from '../components/Orb.tsx';
import type { HomeState } from '../hooks.ts';

const mono = 'font-mono';
const button = `${mono} cursor-pointer rounded-md border px-3 py-2 text-[13px] disabled:cursor-default disabled:opacity-50`;
const quiet = `${button} border-stone bg-transparent text-text hover:bg-raise`;
const primary = `${button} border-signal bg-signal font-medium text-signal-ink hover:brightness-95`;

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className={`${mono} mb-3 flex items-baseline justify-between text-[12px] text-muted`}>
        <h2 id={id} className="m-0 text-[12px] font-normal">
          {title}
        </h2>
        {aside && <span>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Need({
  card,
  first,
  onApprove,
}: {
  card: NeedCard;
  first: boolean;
  onApprove: (c: NeedCard, granted: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (granted: boolean) => {
    setBusy(true);
    try {
      await onApprove(card, granted);
    } finally {
      setBusy(false);
    }
  };
  const a = card.approval;
  return (
    <li
      className={`mb-3 list-none rounded-[10px] border bg-surface p-4 ${first ? 'border-stone' : 'border-line'}`}
    >
      <p className={`${mono} m-0 text-[12px] text-muted`}>
        {[card.kind, card.waiting].filter(Boolean).join(' · ')}
      </p>
      <h3 className={`${mono} mt-2 mb-1 text-[15px] font-bold leading-snug`}>{card.title}</h3>
      <p className="m-0 text-[14px] text-muted">{card.detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {a && (
          <>
            <button type="button" className={primary} disabled={busy} onClick={() => act(true)}>
              {a.approve}
            </button>
            <button type="button" className={quiet} disabled={busy} onClick={() => act(false)}>
              {a.decline}
            </button>
          </>
        )}
        {card.review && (
          <a
            className={`${quiet} no-underline`}
            href={`#/tasks/${encodeURIComponent(card.taskId)}`}
          >
            {card.review}
          </a>
        )}
        {card.others ? (
          <a className={`${quiet} no-underline`} href="#/tasks">
            Show {card.others} others
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Segments({ item }: { item: WorkItem }) {
  if (item.total === 0) return <div aria-hidden="true" className="h-0.5 rounded-full bg-signal" />;
  return (
    <div role="img" aria-label={`${item.done} of ${item.total} steps done`} className="flex gap-1">
      {Array.from({ length: item.total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, never reordered
          key={i}
          className={`h-0.5 flex-1 rounded-full ${i < item.done ? 'bg-signal' : i === item.done ? 'bg-text' : 'bg-line'}`}
        />
      ))}
    </div>
  );
}

function Working({ item }: { item: WorkItem }) {
  return (
    <li className="list-none border-b border-line py-4 first:pt-0 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className={`${mono} m-0 text-[14px] font-bold`}>
          <a
            href={`#/tasks/${encodeURIComponent(item.taskId)}`}
            className="text-text no-underline hover:underline"
          >
            {item.title}
          </a>
        </h3>
        <span className={`${mono} shrink-0 text-[12px] text-muted`}>{item.state}</span>
      </div>
      <Segments item={item} />
      <p className="mt-2 mb-0 text-[14px] text-muted">{item.line}</p>
    </li>
  );
}

function Noticed({ n }: { n: Notice }) {
  return (
    <li className="list-none border-b border-line py-3 first:pt-0">
      <time className={`${mono} text-[12px] text-muted`}>{n.at}</time>
      <p className="mt-1 mb-0 text-[15px] leading-snug">{n.text}</p>
    </li>
  );
}

function CommandBar({
  input,
  value,
  setValue,
}: {
  input: RefObject<HTMLInputElement | null>;
  value: string;
  setValue: (v: string) => void;
}) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const prompt = value.trim();
    if (!prompt) return;
    try {
      const { taskId } = await api.startTask(prompt);
      setValue('');
      window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remy could not start that.');
    }
  };
  return (
    <form
      onSubmit={send}
      className="mt-6 flex items-center gap-3 rounded-[14px] border border-stone bg-surface py-3 pr-3 pl-5"
    >
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Ask your second brain, or tell Remy what to do"
        placeholder="Ask your second brain, or tell Remy what to do"
        className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[17px] text-text outline-none placeholder:text-muted"
      />
      {error && (
        <span role="alert" className={`${mono} text-[12px] text-muted`}>
          {error}
        </span>
      )}
      <kbd
        className={`${mono} hidden rounded border border-line px-2 py-1 text-[11px] text-muted sm:block`}
      >
        ⌘K
      </kbd>
      <button
        type="button"
        disabled
        title="Voice comes later"
        className={`${quiet} hidden size-11 rounded-full p-0 sm:block`}
      >
        talk
      </button>
      <button type="submit" className={`${primary} px-5 py-3`}>
        Send
      </button>
    </form>
  );
}

function Loaded({ data, reload }: { data: HomeData; reload: () => void }) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const approve = async (c: NeedCard, granted: boolean) => {
    if (!c.approval) return;
    await api.approve(c.taskId, {
      callId: c.approval.callId,
      argsHash: c.approval.argsHash,
      granted,
    });
    reload();
  };
  const { briefing, needsYou, working, noticed, alert, brain } = data;
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-8 sm:px-8">
      <div className="grid items-center gap-8 py-8 lg:grid-cols-[560px_minmax(0,1fr)] lg:gap-10">
        <Orb satellites={data.satellites} />
        <div>
          <h1 className="m-0 text-[28px] leading-[1.2] font-medium tracking-tight sm:text-[34px]">
            {briefing.headline} <br />
            <span className="text-muted">{briefing.rest}</span>
          </h1>
          <p className={`${mono} mt-5 mb-0 text-[12px] text-muted`}>{briefing.stats.join(' · ')}</p>
          <ul className="m-0 mt-5 flex flex-wrap gap-3 p-0">
            {briefing.asks.map((q, i) => (
              <li key={q} className="list-none">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(q); // fill the box for the person to send or edit
                    input.current?.focus();
                  }}
                  className={`${mono} cursor-pointer rounded-full border bg-transparent px-4 py-2 text-[13px] text-text hover:bg-raise ${i === 0 ? 'border-signal' : 'border-line'}`}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,420fr)_minmax(0,540fr)_minmax(0,360fr)] lg:gap-7">
        <Section title="Needs you" aside={String(needsYou.length + (alert ? 1 : 0))}>
          <ul className="m-0 p-0">
            {needsYou.map((c, i) => (
              <Need key={c.taskId} card={c} first={i === 0} onApprove={approve} />
            ))}
          </ul>
          {alert && (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <p className="m-0 text-[14px]">{alert.text}</p>
              <a className={`${quiet} shrink-0 no-underline`} href="#/connections">
                {alert.action}
              </a>
            </div>
          )}
          {needsYou.length === 0 && !alert && (
            <p className="m-0 text-[14px] text-muted">Nothing is waiting for you.</p>
          )}
        </Section>
        <Section title="Working now" aside={`${working.length} tasks`}>
          <ul className="m-0 p-0">
            {working.map((w) => (
              <Working key={w.taskId} item={w} />
            ))}
          </ul>
          {working.length === 0 && (
            <p className="m-0 text-[14px] text-muted">Nothing is running.</p>
          )}
        </Section>
        <Section title="Noticed" aside="last 4 hours">
          <ul className="m-0 p-0">
            {noticed.map((n) => (
              <Noticed key={n.at + n.text} n={n} />
            ))}
          </ul>
          {noticed.length === 0 && <p className="m-0 text-[14px] text-muted">Nothing new.</p>}
        </Section>
      </div>

      {brain && (
        <div
          className={`${mono} mt-10 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line pt-5 text-[13px] text-muted`}
        >
          <span>
            <span className="text-signal">Second brain</span>{' '}
            <span className="ml-2">
              <span className="text-text">{brain.notes.toLocaleString('en')}</span> notes linked ·{' '}
              {brain.newToday} new today
            </span>
          </span>
          <span>
            Most connected:{' '}
            {brain.connected.map((c, i) => (
              <span key={c.name}>
                {i > 0 && ' · '}
                <a href="#/brain" className="text-text underline">
                  {c.name}
                </a>{' '}
                ({c.links})
              </span>
            ))}
          </span>
        </div>
      )}
      <CommandBar input={input} value={draft} setValue={setDraft} />
    </div>
  );
}

export function Home({ home }: { home: HomeState }) {
  if (home.error)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <h1 className="m-0 text-[28px] font-medium">Remy could not be reached</h1>
        <p className="mt-3 text-muted">
          {home.error} Check that remy serve is running, then try again.
        </p>
        <button type="button" className={`${quiet} mt-4`} onClick={home.reload}>
          Try again
        </button>
      </div>
    );
  if (!home.data)
    return (
      <p role="status" className={`${mono} px-5 py-12 text-[13px] text-muted sm:px-8`}>
        Loading
      </p>
    );
  return <Loaded data={home.data} reload={home.reload} />;
}

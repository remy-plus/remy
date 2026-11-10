import { useEffect, useId, useMemo, useState } from 'react';
import { type RemyApi, type TaskListItem, useApi } from '../../api/index.tsx';
import { clockOf, type Group, groupOf, primaryButton, stateWord } from './format.ts';

const mono = 'font-mono';

type Filter = 'all' | Group;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'stopped', label: 'Stopped' },
];
const GROUPS: { id: Group; title: string }[] = [
  { id: 'needs', title: 'Needs you' },
  { id: 'running', title: 'Running' },
  { id: 'stopped', title: 'Stopped and finished' },
];

/** "Stopped" in the filter means tasks that ended badly or were paused; finished ones are in the group only. */
const isStopped = (t: TaskListItem) =>
  t.status === 'failed' || t.status === 'cancelled' || t.status === 'paused';

function matches(t: TaskListItem, f: Filter) {
  if (f === 'all') return true;
  if (f === 'stopped') return isStopped(t);
  return groupOf(t.status) === f;
}

function whenOf(t: TaskListItem, group: Group, utc: boolean) {
  if (t.when) return t.when;
  if (group === 'running') return `since ${clockOf(t.createdAt, utc)}`;
  return clockOf(t.updatedAt, utc);
}

function Row({ t, group, api }: { t: TaskListItem; group: Group; api: RemyApi }) {
  const state = t.label ?? stateWord(t.status);
  const live = group === 'running';
  return (
    <li className="list-none border-b border-edge last:border-b-0">
      <a
        href={`#/tasks/${encodeURIComponent(t.id)}`}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-1.5 py-4 text-text no-underline hover:bg-surface sm:grid-cols-[minmax(0,1fr)_180px_110px]"
      >
        <span className="min-w-0">
          <span className="block text-[17px] leading-snug font-semibold">{t.prompt}</span>
          {t.note && <span className="mt-1 block text-[14px] text-muted">{t.note}</span>}
        </span>
        <span
          className={`${mono} text-[12px] sm:text-[13px] ${live ? 'text-signal' : t.status === 'succeeded' ? 'text-muted' : 'text-text'} max-sm:col-start-2 max-sm:row-start-1 max-sm:text-right`}
        >
          {state}
        </span>
        <span
          className={`${mono} text-right text-[12px] whitespace-nowrap text-muted max-sm:col-start-2 max-sm:row-start-2`}
        >
          {whenOf(t, group, api.kind === 'mock')}
        </span>
      </a>
    </li>
  );
}

function Shortcut({
  href,
  eyebrow,
  title,
  text,
}: {
  href: string;
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <a
      href={href}
      className="mb-3 block rounded-[10px] border border-edge bg-surface p-4 text-text no-underline hover:border-edge-hi"
    >
      <span className={`${mono} block text-[12px] text-muted`}>{eyebrow}</span>
      <span className="mt-1 block text-[17px] font-medium">{title}</span>
      <span className="mt-1 block text-[14px] text-muted">{text}</span>
    </a>
  );
}

export function Tasks() {
  const api = useApi();
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const searchId = useId();

  useEffect(() => {
    let live = true;
    api
      .listTasks({ limit: 100 })
      .then((t) => live && setTasks(t))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load.'));
    // The summary card needs the review, which the server cannot give yet: without it the card is plain.
    api
      .review()
      .then((r) => {
        if (!live) return;
        const [tasksTile, needsTile, spentTile] = r.tiles;
        setSummary(
          `${tasksTile?.value} tasks ran, ${needsTile?.value} needs you, ${spentTile?.value} spent.`,
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api]);

  const count = (f: Filter) => (tasks ?? []).filter((t) => matches(t, f)).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks ?? []).filter(
      (t) => matches(t, filter) && (!q || `${t.prompt} ${t.note ?? ''}`.toLowerCase().includes(q)),
    );
  }, [tasks, filter, query]);

  return (
    <div className="grid min-h-[calc(100dvh-66px)] lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 px-5 pt-8 pb-12 sm:px-14">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="m-0 text-[28px] leading-tight font-normal sm:text-[32px]">Tasks</h1>
          <a href="#/" className={`${primaryButton} px-4 py-3`}>
            New task
          </a>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label htmlFor={searchId} className="sr-only">
            Search tasks by what they were about
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks by what they were about"
            className="min-w-0 flex-[1_1_260px] rounded-[10px] border border-edge-hi bg-surface px-5 py-3 text-[16px] text-text outline-none placeholder:text-muted"
          />
          <fieldset aria-label="Filter tasks" className="m-0 flex flex-wrap gap-2 border-0 p-0">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`${mono} cursor-pointer rounded-full border bg-transparent px-4 py-2 text-[12px] whitespace-nowrap ${filter === f.id ? 'border-signal text-text' : 'border-edge text-muted hover:text-text'}`}
              >
                {f.label}
                {tasks && <span className="ml-1.5">{count(f.id)}</span>}
              </button>
            ))}
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="text-[14px] text-muted">
            {error} Check that remy serve is running.
          </p>
        )}
        {!tasks && !error && (
          <p role="status" className={`${mono} text-[13px] text-muted`}>
            Loading
          </p>
        )}
        {tasks && shown.length === 0 && (
          <p className="text-[14px] text-muted">
            {query ? 'No task matches that.' : 'No tasks here.'}
          </p>
        )}
        {GROUPS.map((g) => {
          const rows = shown.filter((t) => groupOf(t.status) === g.id);
          if (!rows.length) return null;
          return (
            <section key={g.id} aria-label={g.title} className="mb-8">
              <div
                className={`${mono} flex items-baseline justify-between border-b border-edge pb-2 text-[12px] text-muted`}
              >
                <h2 className="m-0 text-[12px] font-normal">{g.title}</h2>
                <span>{rows.length}</span>
              </div>
              <ul className="m-0 p-0">
                {rows.map((t) => (
                  <Row key={t.id} t={t} group={g.id} api={api} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <aside
        aria-label="Shortcuts"
        className="border-t border-edge px-5 py-8 lg:border-t-0 lg:border-l lg:px-7"
      >
        <Shortcut
          href="#/review"
          eyebrow="While you were away"
          title="Overnight review"
          text={summary ?? 'See what ran while you were away.'}
        />
        <Shortcut
          href="#/schedules"
          eyebrow="On its own"
          title="Schedules and webhooks"
          text="Work that starts by itself, and when it runs next."
        />
        <Shortcut
          href="#/skills"
          eyebrow="How you like things done"
          title="Skills"
          text="What Remy has learned about your way of working."
        />
      </aside>
    </div>
  );
}

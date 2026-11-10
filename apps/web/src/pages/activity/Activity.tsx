import { useEffect, useState } from 'react';
import { type TaskListItem, type TaskStatus, useApi } from '../../api/index.tsx';
import { ago } from '../../lib/when.ts';

type Kind = 'working' | 'waiting' | 'earlier';

const kindOf = (s: TaskStatus): Kind =>
  s === 'running'
    ? 'working'
    : s === 'waiting_approval' || s === 'waiting_user'
      ? 'waiting'
      : 'earlier';

/** A plain state for a row, with no jargon. */
export const plainState = (s: TaskStatus): string => {
  if (s === 'running') return 'Working';
  if (s === 'waiting_approval' || s === 'waiting_user') return 'Waiting for you';
  if (s === 'succeeded') return 'Done';
  return "Didn't finish";
};

const GROUPS: { kind: Kind; title: string }[] = [
  { kind: 'working', title: 'Working now' },
  { kind: 'waiting', title: 'Waiting for you' },
  { kind: 'earlier', title: 'Earlier' },
];

/** Everything Remy is doing or did, across chats. Each row opens the job. */
export function Activity() {
  const api = useApi();
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .listTasks()
      .then((t) => live && setTasks(t))
      .catch(() => live && setError('Remy could not load its activity.'));
    return () => {
      live = false;
    };
  }, [api]);
  const now = new Date();
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-8 pb-16 sm:px-8">
      <h1 className="m-0 text-[32px] font-medium tracking-tight">Activity</h1>
      <nav aria-label="Shortcuts" className="mt-6 mb-8 grid gap-3 sm:grid-cols-2">
        <a
          href="#/review"
          className="rounded-[14px] border border-edge bg-surface px-5 py-4 text-text no-underline hover:border-edge-hi"
        >
          <span className="block text-[16px] font-medium">Morning summary</span>
          <span className="mt-1 block text-[14px] text-muted">
            What Remy finished overnight, and what needs a look from you.
          </span>
        </a>
        <a
          href="#/schedules"
          className="rounded-[14px] border border-edge bg-surface px-5 py-4 text-text no-underline hover:border-edge-hi"
        >
          <span className="block text-[16px] font-medium">Scheduled jobs</span>
          <span className="mt-1 block text-[14px] text-muted">
            Things Remy does on its own, at the times you set.
          </span>
        </a>
      </nav>
      <p className="mt-2 mb-8 text-[16px] text-muted">What Remy is doing, and what it has done.</p>
      {error && (
        <p role="alert" className="text-[14px] text-muted">
          {error}
        </p>
      )}
      {!tasks && !error && (
        <p role="status" className="text-[14px] text-muted">
          Loading
        </p>
      )}
      {tasks && tasks.length === 0 && (
        <p className="text-[14px] text-muted">
          Nothing yet. When Remy works on a job, it shows here.
        </p>
      )}
      {GROUPS.map((g) => {
        const rows = (tasks ?? []).filter((t) => kindOf(t.status) === g.kind);
        if (!rows.length) return null;
        return (
          <section key={g.kind} aria-label={g.title} className="mb-8">
            <h2 className="m-0 border-b border-edge pb-2 text-[14px] font-medium text-muted">
              {g.title}
            </h2>
            <ul className="m-0 list-none p-0">
              {rows.map((t) => (
                <li key={t.id} className="border-b border-edge last:border-b-0">
                  <a
                    href={`#/tasks/${encodeURIComponent(t.id)}`}
                    className="flex items-baseline justify-between gap-4 px-1.5 py-4 text-text no-underline hover:bg-surface"
                  >
                    <span className="min-w-0 text-[16px] leading-snug">{t.prompt}</span>
                    <span className="shrink-0 text-right text-[13px] text-muted">
                      <span className={g.kind === 'working' ? 'text-text' : ''}>
                        {plainState(t.status)}
                      </span>
                      <span className="block">{ago(t.updatedAt, now)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

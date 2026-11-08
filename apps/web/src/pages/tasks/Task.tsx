import { type FormEvent, type ReactNode, type RefObject, useRef, useState } from 'react';
import {
  type BrainAnswer,
  type HelperView,
  type Making,
  type RemyApi,
  type StreamEvent,
  type TaskFailure,
  type TaskView,
  useApi,
} from '../../api/index.tsx';
import { ApprovalDialog } from '../../components/ApprovalDialog.tsx';
import { buildSteps, Trace } from '../../components/Trace.tsx';
import { clockOf, money, primaryButton, quietButton, RISK } from './format.ts';
import { useTask } from './useTask.ts';

const mono = 'font-mono';
const OPEN = ['running', 'waiting_approval', 'waiting_user', 'paused'];

const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** One line of the log, in plain words. Events the person need not see return null. */
export function describe(e: StreamEvent['event']): string | null {
  const text = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '');
  switch (e.type) {
    case 'task.created':
      return 'started';
    case 'progress':
      return text('text') || null;
    case 'approval.requested':
      return 'asked you before going on';
    case 'approval.resolved':
      return e.granted ? 'you approved' : 'you declined';
    case 'user.asked':
      return 'asked you a question';
    case 'user.answered':
      return 'you answered';
    case 'tool.failed':
      return 'a step failed';
    case 'task.finished':
      return e.status === 'succeeded' ? 'finished' : `stopped. ${text('reason')}`.trim();
    default:
      return null;
  }
}

function Log({
  events,
  utc,
  wide,
}: {
  events: StreamEvent[];
  utc: boolean;
  /** The wide form is for the main column: the time, then the sentence. */
  wide?: boolean;
}) {
  const lines = events.flatMap((e) => {
    const t = describe(e.event);
    return t ? [{ seq: e.seq, at: clockOf(e.at, utc, !wide), text: t }] : [];
  });
  if (!lines.length) return <p className="m-0 text-[14px] text-muted">Nothing yet.</p>;
  return (
    <ul
      className={`${mono} m-0 p-0 text-[13px] leading-[1.7] ${wide ? '' : 'rounded-[10px] border border-line bg-surface px-4 py-3'}`}
    >
      {lines.map((l) => (
        <li key={l.seq} className="flex list-none gap-3 text-muted">
          <time className="shrink-0 text-text">{l.at}</time>
          <span className="min-w-0">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function SideTitle({ children, aside }: { children: ReactNode; aside?: string }) {
  return (
    <div className={`${mono} mb-3 flex items-baseline justify-between text-[12px] text-muted`}>
      <h2 className="m-0 text-[12px] font-normal">{children}</h2>
      {aside && <span>{aside}</span>}
    </div>
  );
}

function WaitingCard({
  view,
  onReview,
  onDecline,
}: {
  view: TaskView;
  onReview: () => void;
  onDecline: () => void;
}) {
  const card = view.pendingApproval;
  if (!card) return null;
  const risk = RISK[card.risk];
  return (
    <div className="mt-3 rounded-[10px] border border-stone bg-surface p-4">
      <p className={`${mono} m-0 text-[12px] text-muted`}>{risk.kind}</p>
      <p className="mt-2 mb-3 text-[15px] leading-snug">{card.preview}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={onReview}>
          {risk.review}
        </button>
        <button type="button" className={quietButton} onClick={onDecline}>
          {risk.decline}
        </button>
      </div>
    </div>
  );
}

function FailureCard({
  failure,
  task,
  api,
  reload,
}: {
  failure: TaskFailure;
  task: TaskView;
  api: RemyApi;
  reload: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (kind: 'retry' | 'done') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'retry') {
        const { taskId } = await api.startTask(task.prompt);
        window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
      } else {
        await api.markDone(task.taskId);
        reload();
      }
    } catch (e) {
      setError(messageOf(e, 'Remy could not do that.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Why this stopped"
      className="mt-3 max-w-[680px] rounded-[10px] border border-stone bg-surface p-4"
    >
      <h3 className={`${mono} m-0 text-[12px] font-normal`}>{failure.title}</h3>
      <p className="mt-1 mb-3 text-[16px] leading-snug">{failure.body}</p>
      {failure.notes.length > 0 && (
        <ul className="m-0 mb-4 list-disc pl-5 text-[14px] text-muted marker:text-stone">
          {failure.notes.map((n) => (
            <li key={n} className="mb-1">
              {n}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {failure.actions.map((a, i) =>
          a.kind === 'link' ? (
            <a key={a.label} href={a.href} className={`${quietButton} py-2`}>
              {a.label}
            </a>
          ) : (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => run(a.kind as 'retry' | 'done')}
              className={`${i === 0 ? primaryButton : quietButton} py-2`}
            >
              {a.label}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className={`${mono} mt-3 mb-0 text-[12px] text-muted`}>
          {error}
        </p>
      )}
    </section>
  );
}

/** What a failed task shows when the server gives no explanation of its own. */
const plainFailure = (reason?: string): TaskFailure => ({
  title: 'Remy stopped this task',
  body: reason ?? 'Something went wrong, and Remy stopped.',
  notes: [],
  why: {
    lead: 'Remy stops instead of guessing.',
    strong:
      'It never repeats something that changes the outside world until it knows the first one failed.',
  },
  actions: [{ label: 'Start again', kind: 'retry' }],
});

function PlanBar({ plan }: { plan: NonNullable<TaskView['plan']> }) {
  return (
    <section aria-label="Plan" className="mb-6">
      <div className={`${mono} mb-2 flex justify-between text-[12px] text-muted`}>
        <h2 className="m-0 text-[12px] font-normal">Plan</h2>
        <span>
          step {plan.current + 1} of {plan.steps.length}
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-5 gap-3 p-0">
        {plan.steps.map((s, i) => (
          <li key={s} className="min-w-0">
            <div
              aria-hidden="true"
              className={`mb-2 h-0.5 ${i < plan.current ? 'bg-signal' : i === plan.current ? 'bg-text' : 'bg-line'}`}
            />
            <span
              className={`${mono} relative block truncate text-[12px] ${i <= plan.current ? 'text-text' : 'text-muted'}`}
            >
              {s}
              <span className="sr-only">
                {i < plan.current ? ' (done)' : i === plan.current ? ' (now)' : ' (later)'}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Helper({ h }: { h: HelperView }) {
  const idle = h.status === 'waiting';
  return (
    <li className="list-none rounded-[10px] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`${mono} m-0 text-[14px] font-bold`}>{h.name}</h3>
        <span className={`${mono} text-[12px] ${idle ? 'text-muted' : 'text-signal'}`}>
          {h.status}
        </span>
      </div>
      <p className="mt-2 mb-1 text-[13px] leading-snug text-muted">{h.note}</p>
      {h.live && (
        <p className={`${mono} m-0 text-[13px] leading-snug`}>
          {h.live}
          <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-2 bg-text align-middle" />
        </p>
      )}
      <div
        role="progressbar"
        aria-label={`${h.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(h.progress * 100)}
        className="mt-3 h-0.5 bg-line"
      >
        <div className="h-full bg-signal" style={{ width: `${h.progress * 100}%` }} />
      </div>
    </li>
  );
}

function MakingPanel({ making, draft }: { making: Making; draft: RefObject<HTMLElement | null> }) {
  return (
    <section aria-label="What Remy is making">
      <SideTitle aside="draft">Making</SideTitle>
      <article
        ref={draft}
        tabIndex={-1}
        className="rounded-[10px] bg-[#edebe6] p-6 text-[#0f0f10] outline-none"
      >
        <p className={`${mono} m-0 mb-2 text-right text-[11px] text-[#67655f]`}>DRAFT</p>
        <h3 className="m-0 text-[17px] font-semibold">{making.title}</h3>
        <p className={`${mono} mt-1 mb-4 text-[11px] text-[#67655f]`}>{making.sub}</p>
        {making.paragraphs.map((p) => (
          <p key={p} className="my-2 text-[13px] leading-snug">
            {p}
          </p>
        ))}
        {making.rows && (
          <table className="my-3 w-full border-collapse text-[12px]">
            <tbody>
              {making.rows.map((r) => (
                <tr key={r.join('|')} className="border-t border-[#d6d3cc]">
                  {r.map((c, i) => (
                    <td key={c} className={`py-1.5 ${i === r.length - 1 ? 'text-right' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
      <ul className="m-0 mt-3 p-0">
        {making.files.map((f) => (
          <li
            key={f.name}
            className={`${mono} flex list-none justify-between gap-3 border-b border-line py-2.5 text-[13px]`}
          >
            <span className="min-w-0 break-words">{f.name}</span>
            <span className="shrink-0 text-muted">{f.meta}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {making.actions.map((a) =>
          a.kind === 'open' ? (
            <button
              key={a.label}
              type="button"
              className={quietButton}
              onClick={() => draft.current?.focus()}
            >
              {a.label}
            </button>
          ) : (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              className={`${primaryButton} disabled:opacity-60`}
            >
              {a.label}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

function BrainView({
  task,
  brain,
  onStart,
}: {
  task: TaskView;
  brain: BrainAnswer;
  onStart: (prompt: string) => void;
}) {
  const evidence = useRef<HTMLElement>(null);
  const c = brain.contradiction;
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 px-5 py-8 sm:px-14 lg:pl-[120px]">
        <h1 className="m-0 mb-8 max-w-[620px] rounded-[10px] border border-line bg-surface px-5 py-4 text-[17px] leading-snug font-normal">
          {task.prompt}
        </h1>
        <p className={`${mono} m-0 mb-3 text-[12px] text-signal`}>
          <span aria-hidden="true">● </span>Remy · {brain.read}
        </p>
        <h2 className="m-0 mb-6 max-w-[700px] text-[26px] leading-[1.25] font-medium sm:text-[28px]">
          {brain.headline}
        </h2>
        <ol className="m-0 mb-6 max-w-[760px] list-none p-0">
          {brain.items.map((it, i) => (
            <li key={it.title} className="mb-4 grid grid-cols-[32px_minmax(0,1fr)] gap-x-1">
              <span className={`${mono} pt-1 text-[12px] text-muted`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="m-0 text-[16px] leading-[1.6]">
                <strong className="font-semibold">{it.title}</strong> {it.text}{' '}
                {it.chips.map((ch) => (
                  <span
                    key={ch}
                    className={`${mono} mr-1.5 inline-block rounded border border-line px-1.5 py-px text-[11px] text-muted`}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
        {c && (
          <section
            aria-label="Contradiction"
            className="max-w-[760px] rounded-[10px] border border-stone bg-surface p-5"
          >
            <h3 className={`${mono} m-0 mb-3 text-[13px] font-normal`}>
              <span aria-hidden="true">◆ </span>Contradiction
            </h3>
            <p className="m-0 mb-4 text-[15px] leading-[1.6]">{c.text}</p>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {[c.left, c.right].map((x) => (
                <div key={x.label} className="rounded-[10px] border border-line bg-bg p-4">
                  <p className={`${mono} m-0 text-[12px] text-muted`}>{x.label}</p>
                  <p className={`${mono} mt-1 mb-0 text-[22px] font-medium`}>{x.value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${primaryButton} py-2.5`}
                onClick={() => onStart(c.draft)}
              >
                {c.draft}
              </button>
              <button
                type="button"
                className={`${quietButton} py-2.5`}
                onClick={() => evidence.current?.focus()}
              >
                Show the evidence
              </button>
            </div>
          </section>
        )}
        {brain.footnote && (
          <p className={`${mono} mt-4 text-[12px] text-muted`}>{brain.footnote}</p>
        )}
      </div>
      <aside
        ref={evidence}
        tabIndex={-1}
        aria-label="Sources"
        className="border-t border-line px-5 py-8 outline-none lg:border-t-0 lg:border-l lg:px-7"
      >
        <SideTitle aside={brain.used}>What Remy used</SideTitle>
        <ol className="m-0 list-none p-0">
          {brain.sources.map((s, i) => (
            <li
              key={s.title}
              className="grid grid-cols-[24px_minmax(0,1fr)] border-b border-line py-3 first:pt-1"
            >
              <span className={`${mono} text-[12px] text-muted`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-[15px] leading-snug">{s.title}</span>
                <span className={`${mono} mt-1 block text-[12px] text-muted`}>{s.meta}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Composer({
  placeholder,
  label,
  onSend,
}: {
  placeholder: string;
  label: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try {
      await onSend(t);
      setText('');
      setError(null);
    } catch (err) {
      setError(messageOf(err, 'Remy could not take that.'));
    }
  };
  return (
    <div className="sticky bottom-0 bg-bg px-5 pt-3 pb-5 sm:px-14">
      <form
        onSubmit={submit}
        className="flex items-center gap-3 rounded-[14px] border border-stone bg-surface py-2.5 pr-2.5 pl-5"
      >
        <input
          id="task-composer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={label}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[16px] text-text outline-none placeholder:text-muted"
        />
        <button type="submit" className={`${primaryButton} px-5 py-2.5`}>
          Send
        </button>
      </form>
      {error && (
        <p role="alert" className={`${mono} mt-2 mb-0 text-[12px] text-muted`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Task({ id }: { id?: string }) {
  if (!id) return null;
  return <TaskScreen key={id} id={id} />;
}

function TaskScreen({ id }: { id: string }) {
  const api = useApi();
  const { view, events, error, reload } = useTask(id);
  const [reviewing, setReviewing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const draft = useRef<HTMLElement>(null);
  const utc = api.kind === 'mock';
  const clock = (iso: string) => clockOf(iso, utc);

  if (error && !view)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <h1 className="m-0 text-[28px] font-medium">This task could not be opened</h1>
        <p className="mt-3 text-muted">{error}</p>
        <a href="#/tasks" className={`${quietButton} mt-4 inline-block`}>
          Back to tasks
        </a>
      </div>
    );
  if (!view)
    return (
      <p role="status" className={`${mono} px-5 py-12 text-[13px] text-muted sm:px-8`}>
        Loading
      </p>
    );

  const open = OPEN.includes(view.status);
  const act = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setProblem(messageOf(e, 'Remy could not do that.'));
    }
  };
  const start = async (prompt: string) => {
    const { taskId } = await api.startTask(prompt);
    window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
  };
  const card = view.pendingApproval;
  const decline = () =>
    card &&
    act(() => api.approve(id, { callId: card.callId, argsHash: card.argsHash, granted: false }));
  const focusComposer = () =>
    setTimeout(() => document.getElementById('task-composer')?.focus(), 0);

  if (view.brain) {
    return (
      <div className="flex min-h-[calc(100dvh-66px)] flex-col">
        <BrainView task={view} brain={view.brain} onStart={(p) => act(() => start(p))} />
        {problem && (
          <p role="alert" className={`${mono} px-5 text-[12px] text-muted sm:px-14`}>
            {problem}
          </p>
        )}
        <Composer
          label="Ask a follow-up"
          placeholder="Ask a follow-up, or tell Remy to fix it"
          onSend={start}
        />
      </div>
    );
  }

  const failed = view.status === 'failed';
  const failure = failed ? (view.failure ?? plainFailure(view.final?.reason)) : null;
  const steps = buildSteps(view, clock);
  const failedStep = steps.find((s) => s.state === 'failed');
  const cards: Record<string, ReactNode> = {};
  if (card)
    cards[card.callId] = (
      <WaitingCard view={view} onReview={() => setReviewing(true)} onDecline={() => decline()} />
    );
  if (failure && failedStep)
    cards[failedStep.id] = <FailureCard failure={failure} task={view} api={api} reload={reload} />;

  const lastAt = [...view.calls].reverse().find((c) => c.at)?.at;
  const helpers = view.helpers;
  const meta = [
    `Started ${clock(view.createdAt)}`,
    failed && lastAt && `Stopped ${lastAt.length > 5 ? clock(lastAt) : lastAt}`,
    helpers && `${helpers.length} helpers`,
    !helpers && view.step > 0 && open && `Step ${view.step}`,
    `${money(view.costUsd)}${open ? ` of ${money(view.config.budget.maxCostUsd)} budget` : ''}`,
  ].filter(Boolean);

  const sideLog = (
    <aside
      aria-label="What Remy did"
      className="border-t border-line px-5 py-8 lg:border-t-0 lg:border-l lg:px-8"
    >
      <SideTitle>What Remy did</SideTitle>
      <Log events={events} utc={utc} />
      {failure && (
        <>
          <div className={`${mono} mt-6 mb-2 text-[12px] text-muted`}>
            <h2 className="m-0 text-[12px] font-normal">Why Remy did not retry</h2>
          </div>
          <p className="m-0 text-[14px] leading-[1.6] text-muted">
            {failure.why.lead}{' '}
            <strong className="font-medium text-text">{failure.why.strong}</strong>
          </p>
        </>
      )}
    </aside>
  );

  return (
    <div className="flex min-h-[calc(100dvh-66px)] flex-col">
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 px-5 pt-8 pb-8 sm:px-14">
          <h1 className="m-0 mb-2 text-[28px] leading-tight font-normal sm:text-[32px]">
            {view.prompt}
          </h1>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className={`${mono} m-0 text-[12px] text-muted`}>{meta.join(' · ')}</p>
            {open && (
              <button
                type="button"
                className={quietButton}
                onClick={() => act(() => api.cancel(id))}
              >
                Stop task
              </button>
            )}
          </div>

          {problem && (
            <p role="alert" className={`${mono} mb-4 text-[12px] text-text`}>
              {problem}
            </p>
          )}

          {view.pause && (
            <section
              aria-label="Paused"
              className="mb-6 max-w-[680px] rounded-[10px] border border-stone bg-surface p-4"
            >
              <p className="m-0 mb-1 text-[16px]">
                Remy paused at the {view.pause.limit} limit: {view.pause.steps} steps,{' '}
                {money(view.pause.costUsd)}.
              </p>
              <p className="m-0 mb-3 text-[14px] text-muted">
                Add to the budget to continue, or stop here.
              </p>
              <button
                type="button"
                className={primaryButton}
                onClick={() => act(() => api.extend(id, {}))}
              >
                Continue task
              </button>
            </section>
          )}

          {view.held && (
            <p className="mb-6 max-w-[680px] text-[14px] text-muted">{view.held.summary}</p>
          )}

          {view.pendingQuestion && (
            <section
              aria-label="Question from Remy"
              className="mb-6 max-w-[680px] rounded-[10px] border border-stone bg-surface p-4"
            >
              <p className={`${mono} m-0 text-[12px] text-muted`}>Remy asks</p>
              <p className="mt-2 mb-3 text-[16px]">{view.pendingQuestion.question}</p>
              <button type="button" className={quietButton} onClick={focusComposer}>
                Answer below
              </button>
            </section>
          )}

          {view.plan && <PlanBar plan={view.plan} />}

          {helpers && (
            <section aria-label="Helpers" className="mb-6">
              <SideTitle aside="working at the same time">Helpers</SideTitle>
              <ul className="m-0 grid gap-3 p-0 sm:grid-cols-2">
                {helpers.map((h) => (
                  <Helper key={h.name} h={h} />
                ))}
              </ul>
            </section>
          )}

          {view.found && (
            <p className="mb-6 rounded-[10px] border border-stone px-5 py-4 text-[15px] leading-snug">
              <span aria-hidden="true">◆ </span>
              <strong className="font-semibold">Found something while working.</strong> {view.found}
            </p>
          )}

          {view.final?.answer && (
            <section aria-label="Answer" className="mb-6 max-w-[680px]">
              <p className="m-0 text-[17px] leading-[1.6]">{view.final.answer}</p>
            </section>
          )}

          {!helpers && <Trace steps={steps} cards={cards} />}

          {helpers && (
            <section aria-label="Activity">
              <SideTitle aside="everything Remy did, in order">Activity</SideTitle>
              <Log events={events} utc={utc} wide />
            </section>
          )}
        </div>

        {helpers && view.making ? (
          <aside
            aria-label="Draft"
            className="border-t border-line px-5 py-8 lg:border-t-0 lg:border-l lg:px-8"
          >
            <MakingPanel making={view.making} draft={draft} />
          </aside>
        ) : (
          sideLog
        )}
      </div>

      {view.status !== 'cancelled' && !failed && (
        <Composer
          label={view.pendingQuestion ? 'Your answer' : 'Add a note for Remy'}
          placeholder={
            view.pendingQuestion
              ? 'Type your answer'
              : view.final
                ? 'Ask a follow-up'
                : 'Tell Remy something while it works'
          }
          onSend={async (t) => {
            if (view.final) return start(t);
            await api.answer(id, t);
            reload();
          }}
        />
      )}

      {reviewing && card && (
        <ApprovalDialog
          taskId={id}
          view={view}
          onClose={() => setReviewing(false)}
          onResolved={reload}
          onEdit={focusComposer}
        />
      )}
    </div>
  );
}
